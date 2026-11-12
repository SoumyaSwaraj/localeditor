/* LocalEditor: PDF studio office kit. See docs/ROADMAP.md D11, D14, D15, D16, D19, D20 and docs/FORMAT-PDF-WORKFLOW.md.
   Part 1 is LE.pdfOffice: byte-level functions any page can reuse (fill from saved details, compare two versions, bundle,
   stamps and comment summary, saved PDF workflows, fingerprint receipts). Part 2 is the "Office kit" area of the PDF studio.
   Everything runs on this device. Saved details and passwords are never logged; passwords are never stored. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var d = global.document;

  /* =====================================================================
     Part 1 — LE.pdfOffice
     ===================================================================== */

  var VERSION = 1;
  var VERIFY_BASE = 'https://localeditor.net/verify/';
  var MAX_BUNDLE_PAGES = 3000;

  function PL() { return global.PDFLib; }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function safeKey(k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }
  function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, ''); }
  function str(v) { return v == null ? '' : String(v); }
  function trimTo(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function toBytes(input) {
    if (input == null) return Promise.reject(new Error('No file'));
    if (input instanceof Uint8Array) return Promise.resolve(input);
    if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
    if (ArrayBuffer.isView(input)) return Promise.resolve(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    if (typeof Blob !== 'undefined' && input instanceof Blob) return input.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    if (input && input._bytes) return Promise.resolve(input._bytes);
    return Promise.reject(new Error('Expected a PDF file or bytes'));
  }
  function ready() {
    if (LE.pdf && LE.pdf.ready) return LE.pdf.ready();
    return Promise.reject(new Error('The PDF engine is not loaded'));
  }
  /* pdf.js, always with isEvalSupported: false (CVE-2024-4367). */
  function pdfjsOpen(bytes, password) {
    var params = { data: u8(bytes).slice(0), isEvalSupported: false };
    if (password != null) params.password = password;
    return global.pdfjsLib.getDocument(params).promise;
  }
  async function loadDoc(bytes) {
    try { return await PL().PDFDocument.load(u8(bytes).slice(0), { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && e.message))) {
        var err = new Error('This PDF is locked with a password. Unlock it first (Bulk → Password-protect or unlock).');
        err.code = 'password';
        throw err;
      }
      throw new Error('This file could not be read as a PDF.');
    }
  }
  function cancelledError() { var e = new Error('Cancelled'); e.cancelled = true; return e; }
  function checkCancel(opts) {
    if (opts && ((opts.signal && opts.signal.aborted) || (typeof opts.isCancelled === 'function' && opts.isCancelled()))) throw cancelledError();
  }
  function progress(opts, done, total, label) { if (opts && typeof opts.onProgress === 'function') opts.onProgress(done, total, label); }
  function withReport(bytes, report) {
    var out = u8(bytes);
    try { Object.defineProperty(out, 'report', { value: report, enumerable: false, configurable: true, writable: true }); } catch (e) { out.report = report; }
    return out;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(dt) { dt = dt || new Date(); return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }
  function niceDate(dt) {
    dt = dt || new Date();
    try { return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return isoDate(dt); }
  }
  function niceTime(dt) {
    dt = dt || new Date();
    try { return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()); }
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' bytes';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str(hex).trim());
    if (!m) return [0.2, 0.2, 0.2];
    var h = m[1].length === 3 ? m[1].replace(/./g, function (c) { return c + c; }) : m[1];
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  function rgb(hex) { var c = hexToRgb(hex); return PL().rgb(c[0], c[1], c[2]); }
  function normText(s) {
    s = str(s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, '-').replace(/[  -​ ]/g, ' ');
  }
  function fold(s) {
    s = str(s);
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ø/g, 'o').replace(/æ/g, 'ae');
  }

  /* ---------- fonts and drawing ---------- */

  function winAnsiOk(t) { return /^[\x20-\x7e -ÿ–—‘’“”•…€\n]*$/.test(str(t)); }
  /* Fonts for generated pages: Plus Jakarta Sans and Lora from the font library (embedded through LE.pdf.embedFont, which
     unwraps WOFF and fixes the subsetter), standard PDF fonts when those cannot load. */
  async function fontsFor(doc) {
    if (doc.__leoFonts) return doc.__leoFonts;
    var f = {};
    var E = LE.pdf && LE.pdf.embedFont;
    var rep = { warnings: [] };
    async function one(family, weight, std) {
      if (E && LE.fonts && LE.fonts.bytes) {
        try { return await E(doc, family, weight, false, rep); } catch (e) {}
      }
      return doc.embedFont(PL().StandardFonts[std]);
    }
    f.sans = await one('Plus Jakarta Sans', 400, 'Helvetica');
    f.bold = await one('Plus Jakarta Sans', 700, 'HelveticaBold');
    f.serif = await one('Lora', 700, 'TimesRomanBold');
    f.mono = await one('JetBrains Mono', 400, 'Courier');
    f.custom = !!(f.sans && f.sans.name && !/^Helvetica/.test(f.sans.name));
    doc.__leoFonts = f;
    return f;
  }
  function safeFor(font, text) {
    text = str(text).replace(/\r?\n/g, ' ');
    try { font.encodeText(text); return text; } catch (e) {}
    var out = '';
    for (var i = 0; i < text.length; i++) { var c = text.charAt(i); try { font.encodeText(c); out += c; } catch (e2) { out += '?'; } }
    return out;
  }
  function widthOf(font, text, size) { try { return font.widthOfTextAtSize(safeFor(font, text), size); } catch (e) { return str(text).length * size * 0.5; } }
  function wrapLines(font, text, size, maxW) {
    var out = [];
    str(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var next = line ? line + ' ' + w : w;
        if (line && widthOf(font, next, size) > maxW) { out.push(line); line = w; }
        else line = next;
        while (widthOf(font, line, size) > maxW && line.length > 1) {
          var cut = line.length - 1;
          while (cut > 1 && widthOf(font, line.slice(0, cut), size) > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      });
      out.push(line);
    });
    return out;
  }
  /* Geometry of a page as it is shown (crop box and /Rotate applied). Visual coordinates: points, origin top-left. */
  function geom(page) {
    var box;
    try { box = page.getCropBox(); } catch (e) { box = page.getMediaBox(); }
    var rot = 0;
    try { rot = page.getRotation().angle || 0; } catch (e) {}
    rot = ((rot % 360) + 360) % 360;
    var W = box.width, H = box.height;
    var vw = rot % 180 ? H : W, vh = rot % 180 ? W : H;
    function pt(vx, vy) {
      var bx = vx, by = vh - vy, ux, uy;
      if (rot === 90) { ux = W - by; uy = bx; }
      else if (rot === 180) { ux = W - bx; uy = H - by; }
      else if (rot === 270) { ux = by; uy = H - bx; }
      else { ux = bx; uy = by; }
      return { x: box.x + ux, y: box.y + uy };
    }
    function rect(vx, vy, w, h) {
      var a = pt(vx, vy), b = pt(vx + w, vy + h);
      return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    }
    return { page: page, w: vw, h: vh, rot: rot, pt: pt, rect: rect };
  }
  function drawText(g, text, vx, vyBaseline, size, font, color, opts) {
    opts = opts || {};
    var p = g.pt(vx, vyBaseline);
    var o = { x: p.x, y: p.y, size: size, font: font, color: color || rgb('#16131C'), rotate: PL().degrees(g.rot + (opts.angle || 0)) };
    if (opts.opacity != null) o.opacity = opts.opacity;
    g.page.drawText(safeFor(font, text), o);
  }
  function drawBox(g, vx, vy, w, h, opts) {
    var p = g.pt(vx, vy + h);
    var o = { x: p.x, y: p.y, width: w, height: h, rotate: PL().degrees(g.rot) };
    if (opts.fill) o.color = rgb(opts.fill);
    if (opts.opacity != null) o.opacity = opts.opacity;
    if (opts.border) { o.borderColor = rgb(opts.border); o.borderWidth = opts.borderWidth || 1; if (opts.borderOpacity != null) o.borderOpacity = opts.borderOpacity; }
    g.page.drawRectangle(o);
  }
  function drawRule(g, vx, vy, w, color, thick) {
    var a = g.pt(vx, vy), b = g.pt(vx + w, vy);
    g.page.drawLine({ start: a, end: b, thickness: thick || 0.6, color: rgb(color || '#D8D4CD') });
  }
  /* An internal link: a Link annotation on `page` that opens `target` (a PDFPage). */
  function addLink(doc, page, rect, target) {
    var lib = PL();
    var ctx = doc.context;
    var annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: [target.ref, 'Fit'] });
    var ref = ctx.register(annot);
    var annots = page.node.lookup(lib.PDFName.of('Annots'));
    if (annots instanceof lib.PDFArray) annots.push(ref);
    else page.node.set(lib.PDFName.of('Annots'), ctx.obj([ref]));
    return ref;
  }
  /* Bookmarks: nodes = [{ title, page: PDFPage, children: [...] }] */
  function setOutline(doc, nodes) {
    var lib = PL(), ctx = doc.context;
    if (!nodes || !nodes.length) return 0;
    var count = 0;
    function build(list, parentRef) {
      var refs = list.map(function () { return ctx.nextRef(); });
      var visible = list.length;
      list.forEach(function (n, i) {
        count++;
        var dict = ctx.obj({ Title: lib.PDFHexString.fromText(trimTo(n.title || 'Untitled', 200)), Parent: parentRef, Dest: [n.page.ref, 'Fit'] });
        if (i > 0) dict.set(lib.PDFName.of('Prev'), refs[i - 1]);
        if (i < list.length - 1) dict.set(lib.PDFName.of('Next'), refs[i + 1]);
        if (n.children && n.children.length) {
          var sub = build(n.children, refs[i]);
          dict.set(lib.PDFName.of('First'), sub.first);
          dict.set(lib.PDFName.of('Last'), sub.last);
          dict.set(lib.PDFName.of('Count'), lib.PDFNumber.of(n.open === false ? -sub.visible : sub.visible));
          if (n.open !== false) visible += sub.visible;
        }
        ctx.assign(refs[i], dict);
      });
      return { first: refs[0], last: refs[refs.length - 1], visible: visible };
    }
    var root = ctx.nextRef();
    var top = build(nodes, root);
    ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: lib.PDFNumber.of(top.visible) }));
    doc.catalog.set(lib.PDFName.of('Outlines'), root);
    doc.catalog.set(lib.PDFName.of('PageMode'), lib.PDFName.of('UseOutlines'));
    return count;
  }
  async function readOutline(pdf) {
    var items = [];
    try { items = (await pdf.getOutline()) || []; } catch (e) { return []; }
    async function map(item, depth) {
      var page = null;
      try {
        var dest = item.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (dest && dest[0]) page = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
      } catch (e) { page = null; }
      var kids = [];
      if (depth < 3) for (var i = 0; i < (item.items || []).length && i < 200; i++) kids.push(await map(item.items[i], depth + 1));
      return { title: item.title || '', page: page, children: kids };
    }
    var out = [];
    for (var i = 0; i < items.length && i < 400; i++) out.push(await map(items[i], 0));
    return out;
  }

  /* ---------- SHA-256 ---------- */

  var K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  /* Pure-JS fallback for pages served without a secure context (where crypto.subtle is missing). */
  function sha256js(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var bits = len * 8, dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, bits >>> 0);
    dv.setUint32(total - 8, Math.floor(bits / 4294967296));
    var w = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], dd = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (dd + t1) >>> 0; dd = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + dd) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (v) { return ('00000000' + v.toString(16)).slice(-8); }).join('');
  }
  async function sha256(input) {
    var bytes = await toBytes(input);
    var subtle = global.crypto && global.crypto.subtle;
    if (subtle && subtle.digest) {
      try {
        var hash = new Uint8Array(await subtle.digest('SHA-256', bytes));
        return Array.prototype.map.call(hash, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      } catch (e) {}
    }
    return sha256js(u8(bytes));
  }
  /* A short form people can read aloud and compare: the first 16 hex characters in four groups. */
  function shortHash(hex) { return str(hex).slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, '$1 '); }
  function verifyUrl(hex, opts) {
    var base = (opts && opts.base) || VERIFY_BASE;
    return base.replace(/#.*$/, '') + '#sha256=' + str(hex).toLowerCase();
  }
  function hashFromUrl(url) {
    var m = /[#&]sha256=([0-9a-fA-F]{64})(?:&|$)/.exec(str(url));
    return m ? m[1].toLowerCase() : null;
  }

  /* =====================================================================
     D11 — saved details
     ===================================================================== */

  var DETAILS_KEY = 'le-pdf-details';
  var MAPS_KEY = 'le-pdf-details-maps';
  var DETAIL_FIELDS = [
    ['title', 'Title (Mr, Ms, Dr…)', 'name'], ['firstName', 'First name', 'name'], ['middleName', 'Middle name', 'name'], ['lastName', 'Last name', 'name'], ['fullName', 'Full name (if different)', 'name'],
    ['address1', 'Address line 1', 'address'], ['address2', 'Address line 2', 'address'], ['city', 'Town or city', 'address'], ['region', 'County, state or region', 'address'], ['postcode', 'Postcode, ZIP or PIN', 'address'], ['country', 'Country', 'address'],
    ['phone', 'Phone', 'contact'], ['mobile', 'Mobile', 'contact'], ['email', 'Email', 'contact'], ['website', 'Website', 'contact'],
    ['dob', 'Date of birth', 'personal'],
    ['company', 'Company or organisation', 'work'], ['jobTitle', 'Job title', 'work'], ['companyNumber', 'Company registration number', 'work'], ['taxId', 'Tax number', 'work'], ['vatNumber', 'VAT or GST number', 'work'],
    ['bankName', 'Bank', 'bank'], ['accountName', 'Account holder', 'bank'], ['accountNumber', 'Account number', 'bank'], ['sortCode', 'Sort code, routing or IFSC', 'bank'], ['iban', 'IBAN', 'bank'], ['swift', 'SWIFT or BIC', 'bank']
  ];
  var DETAIL_IDS = DETAIL_FIELDS.map(function (f) { return f[0]; });
  var DETAIL_LABEL = {};
  DETAIL_FIELDS.forEach(function (f) { DETAIL_LABEL[f[0]] = f[1]; });
  DETAIL_LABEL.today = 'Today’s date';

  function lsGet(key, dflt) {
    try { var raw = global.localStorage.getItem(key); return raw ? JSON.parse(raw) : dflt; } catch (e) { return dflt; }
  }
  function lsSet(key, val) {
    try { global.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function lsDel(key) { try { global.localStorage.removeItem(key); } catch (e) {} }

  function cleanText(v, max) { return str(v).replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
  /* One profile, normalised. Unknown keys are dropped. */
  function normProfile(p) {
    p = p && typeof p === 'object' ? p : {};
    var out = { id: /^[a-z0-9-]{3,48}$/.test(str(p.id)) ? p.id : uid('me'), label: cleanText(p.label, 60) || 'Me', kind: p.kind === 'company' ? 'company' : 'person', fields: {}, ids: [], signatureId: null, updatedAt: num(p.updatedAt, Date.now()) };
    var f = p.fields && typeof p.fields === 'object' ? p.fields : {};
    DETAIL_IDS.forEach(function (k) { if (own(f, k) && str(f[k]).trim()) out.fields[k] = cleanText(f[k], k === 'address1' || k === 'address2' ? 160 : 120); });
    if (out.fields.dob && !/^\d{4}-\d{2}-\d{2}$/.test(out.fields.dob)) {
      var m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(out.fields.dob);
      if (m) out.fields.dob = m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
      else delete out.fields.dob;
    }
    (Array.isArray(p.ids) ? p.ids : []).slice(0, 20).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var label = cleanText(x.label, 60), value = cleanText(x.value, 120);
      if (label && value) out.ids.push({ label: label, value: value });
    });
    if (/^[\w-]{1,80}$/.test(str(p.signatureId))) out.signatureId = p.signatureId;
    return out;
  }
  function profileValue(p, key) {
    var f = (p && p.fields) || {};
    if (key === 'fullName') return f.fullName || [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' ');
    if (key === 'firstLast') return [f.firstName, f.lastName].filter(Boolean).join(' ');
    if (key === 'mobile') return f.mobile || f.phone || '';
    if (key === 'phone') return f.phone || f.mobile || '';
    if (key === 'address') return [f.address1, f.address2].filter(Boolean).join(', ');
    if (key === 'cityLine') return [f.city, f.region, f.postcode].filter(Boolean).join(' ');
    if (key === 'middleInitial') return f.middleName ? f.middleName.charAt(0).toUpperCase() : '';
    if (key === 'today') return '';
    if (/^id:\d+$/.test(key)) { var x = (p.ids || [])[+key.slice(3)]; return x ? x.value : ''; }
    return f[key] || '';
  }
  var details = {
    fields: function () { return DETAIL_FIELDS.map(function (f) { return { id: f[0], label: f[1], group: f[2] }; }); },
    list: function () { var all = lsGet(DETAILS_KEY, null); return all && Array.isArray(all.profiles) ? all.profiles.map(normProfile) : []; },
    get: function (id) { return details.list().filter(function (p) { return p.id === id; })[0] || null; },
    save: function (profile) {
      var p = normProfile(profile);
      p.updatedAt = Date.now();
      var list = details.list().filter(function (x) { return x.id !== p.id; });
      list.unshift(p);
      if (list.length > 12) throw new Error('Up to 12 sets of details can be saved.');
      if (!lsSet(DETAILS_KEY, { v: 1, profiles: list })) throw new Error('This browser would not save the details (storage is full or blocked).');
      return p;
    },
    remove: function (id) {
      var list = details.list().filter(function (x) { return x.id !== id; });
      if (list.length) lsSet(DETAILS_KEY, { v: 1, profiles: list }); else lsDel(DETAILS_KEY);
      return true;
    },
    /* Removes every saved profile and every remembered form mapping. */
    eraseAll: function () { lsDel(DETAILS_KEY); lsDel(MAPS_KEY); return true; },
    value: profileValue,
    /* A file people can keep or move to another device. Plain JSON: it contains the details themselves, so treat it like the details. */
    exportText: function (ids) {
      var list = details.list().filter(function (p) { return !ids || ids.indexOf(p.id) >= 0; });
      return JSON.stringify({ format: 'localeditor-details', version: '1.0', exported: isoDate(), profiles: list.map(function (p) { var c = JSON.parse(JSON.stringify(p)); delete c.signatureId; return c; }) }, null, 2);
    },
    /* Reads an export. Returns { ok, profiles, errors }; nothing is saved until saveAll/save is called. */
    parse: function (text) {
      var errors = [];
      text = str(text);
      if (text.length > 200000) return { ok: false, errors: ['The file is too large to be a details file.'], profiles: [] };
      var data;
      try { data = JSON.parse(text); } catch (e) { return { ok: false, errors: ['This is not a LocalEditor details file.'], profiles: [] }; }
      if (!data || data.format !== 'localeditor-details' || !Array.isArray(data.profiles)) return { ok: false, errors: ['This is not a LocalEditor details file.'], profiles: [] };
      if (hasBadKey(data, 0)) return { ok: false, errors: ['The file contains forbidden keys.'], profiles: [] };
      var profiles = data.profiles.slice(0, 12).map(function (p) { var n = normProfile(p); n.id = uid('me'); return n; });
      if (!profiles.length) errors.push('The file has no details in it.');
      return { ok: !errors.length, errors: errors, profiles: profiles };
    },
    importText: function (text) {
      var r = details.parse(text);
      if (!r.ok) return r;
      r.profiles.forEach(function (p) { details.save(p); });
      return r;
    }
  };

  /* Field matching. Rules run in order; the first that matches wins. Patterns run on the folded, lower-case text of the
     field name, its tooltip and the nearest label printed on the page. A few languages are covered for the basics. */
  var NEVER = /\b(password|passwort|passcode|pass word|pwd|mot de passe|contrasena|senha|wachtwoord|pin|pin number|cvv|cvc|cvv2|security code|otp|one time|secret|signature|signatur|unterschrift|firma|signer|signed by|sign here|initials? here)\b/;
  var RULES = [
    ['email', /\b(e ?mail|email address|courriel|correo( electronico)?|e post|epost)\b/],
    ['dob', /\b(date of birth|birth ?date|d ?o ?b|birthday|born on|geburtsdatum|geburtstag|date de naissance|fecha de nacimiento|data di nascita|geboortedatum|data de nascimento|naissance)\b/],
    ['postcode', /\b(post ?code|postal ?code|zip|zip ?code|zipcode|pin ?code|pincode|plz|postleitzahl|code postal|codigo postal|cap|cp|postcode)\b/],
    ['mobile', /\b(mobile|mobil|mob|cell|cellphone|cell phone|handy|portable|movil|celular|cellulare|mobielnummer)\b/],
    ['phone', /\b(phone|telephone|tel|tel no|telefon|telefono|telefone|telefoon|phone number|contact number|daytime number|landline)\b/],
    ['website', /\b(website|web site|homepage|url|web address)\b/],
    ['iban', /\b(iban)\b/],
    ['swift', /\b(swift|bic|swift code|bic code)\b/],
    ['sortCode', /\b(sort ?code|routing( number)?|aba|bsb|ifsc|bankleitzahl|blz|transit number)\b/],
    ['accountName', /\b(account ?(holder|name)|name of account holder|beneficiary( name)?|kontoinhaber|titulaire( du compte)?)\b/],
    ['accountNumber', /\b(account ?(number|no|num)|acct( no| number)?|bank account|kontonummer|numero de compte|numero de cuenta|conto)\b/],
    ['bankName', /\b(bank ?name|name of bank|bank|banque|banco|kreditinstitut|bankname)\b/],
    ['vatNumber', /\b(vat( number| no| reg(istration)?( number)?| id)?|ust ?id|ust idnr|mwst|tva|iva|gst( number| no)?|btw|gstin)\b/],
    ['companyNumber', /\b(company (registration )?(number|no)|registration (number|no)|reg (no|number)|crn|handelsregister|siren|siret|cin|kvk|abn|acn)\b/],
    ['taxId', /\b(tax ?(id|number|no|code|reference|ref)|tin|ein|utr|steuernummer|steuer ?id|steuer identifikationsnummer|nif|codice fiscale|numero fiscal|cpf|pan( number| no)?)\b/],
    ['jobTitle', /\b(job ?title|position|occupation|role|beruf|profession|designation|fonction|cargo|puesto)\b/],
    ['company', /\b(company( name)?|employer( name)?|organi[sz]ation( name)?|business( name)?|firm|unternehmen|entreprise|societe|empresa|azienda|bedrijf|employer s name)\b/],
    ['title', /\b(title|salutation|anrede|civilite|tratamiento|honorific|mr ?mrs|prefix)\b/],
    ['firstName', /\b(first ?names?|given ?names?|forenames?|vorname|prenoms?|nombre( de pila)?|nome|voornaam|fname|first)\b/],
    ['middleName', /\b(middle ?names?|middle ?initial|second name|mi)\b/],
    ['lastName', /\b(last ?names?|surname|family ?names?|nachname|familienname|nom de famille|nom|apellidos?|cognome|achternaam|sobrenome|lname|last)\b/],
    ['fullName', /\b(full ?name|your name|name|applicant( s)? name|employee( s)? name|print(ed)? name|name in full|nom complet|nombre completo|vollstandiger name|naam|nome completo|name of applicant|contact name)\b/],
    ['address2', /\b(address ?(line )?2|address2|addr ?2|street ?2|apt|apartment|suite|unit|flat( number)?|address line two)\b/],
    ['city', /\b(city|town|town or city|ort|stadt|wohnort|ville|ciudad|citta|plaats|woonplaats|cidade|locality|suburb)\b/],
    ['region', /\b(county|state|province|region|bundesland|departement|provincia|prefecture|state province)\b/],
    ['country', /\b(country|land|pays|pais|paese|nation)\b/],
    ['address1', /\b(address ?(line )?1|address1|addr ?1|street( address)?|strasse|str|adresse|direccion|domicilio|indirizzo|adres|morada|endereco|address|addr|house|home address|residential address)\b/]
  ];
  var TODAY = /^(date|datum|fecha|data|today|today s date|todays date|date signed|signed date|signature date|date of signing|date of application|application date|date today)$/;
  function fieldText(s) {
    return ' ' + fold(str(s)).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_.\-\/\\:#()[\]*]+/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ') + ' ';
  }
  function classify(text, profile) {
    var t = fieldText(text);
    var core = t.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!core) return null;
    if (NEVER.test(t) && !/\b(pin ?code|pincode)\b/.test(t)) return { never: true };
    var ids = (profile && profile.ids) || [];
    for (var i = 0; i < ids.length; i++) {
      var lt = fieldText(ids[i].label).trim();
      if (lt && lt.split(' ').every(function (w) { return t.indexOf(' ' + w + ' ') >= 0; })) return { key: 'id:' + i };
    }
    if (TODAY.test(core)) return { key: 'today' };
    for (var r = 0; r < RULES.length; r++) if (RULES[r][1].test(t)) return { key: RULES[r][0] };
    return null;
  }
  function dateOrderFor(text) {
    var t = fold(str(text)).toLowerCase();
    if (/yyyy[\s\-\/.]?mm[\s\-\/.]?dd|aaaa[\s\-\/.]?mm/.test(t)) return 'ymd';
    if (/mm[\s\-\/.]?dd/.test(t)) return 'mdy';
    if (/dd[\s\-\/.]?mm|jj[\s\-\/.]?mm|tt[\s\-\/.]?mm|gg[\s\-\/.]?mm/.test(t)) return 'dmy';
    return null;
  }
  function localeOrder() {
    var lang = '';
    try { lang = (global.navigator && (navigator.language || '')) || ''; } catch (e) {}
    return /^en-US|^en-PH|^en-CA/i.test(lang) ? 'mdy' : /^(zh|ja|ko|hu|lt|sv-SE)/i.test(lang) ? 'ymd' : 'dmy';
  }
  function formatDate(iso, order, sep) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
    if (!m) return str(iso);
    if (order === 'ymd') return m[1] + '-' + m[2] + '-' + m[3];
    sep = sep || '/';
    return order === 'mdy' ? m[2] + sep + m[3] + sep + m[1] : m[3] + sep + m[2] + sep + m[1];
  }
  function pickOption(options, value) {
    var v = fold(value).toLowerCase().trim();
    if (!v || !options || !options.length) return null;
    var exact = options.filter(function (o) { return fold(o).toLowerCase().trim() === v; })[0];
    if (exact != null) return exact;
    var starts = options.filter(function (o) { var f = fold(o).toLowerCase().trim(); return f && (f.indexOf(v) === 0 || v.indexOf(f) === 0); })[0];
    return starts != null ? starts : null;
  }

  /* Reads the fillable fields of a PDF with pdf.js: name, type, tooltip, the label printed nearest to it, limits. */
  async function formFields(input, opts) {
    await ready();
    var bytes = await toBytes(input);
    var pdf = await pdfjsOpen(bytes, opts && opts.password);
    var out = [];
    try {
      for (var i = 1; i <= pdf.numPages && i <= 200; i++) {
        var page = await pdf.getPage(i);
        var annots = [];
        try { annots = await page.getAnnotations({ intent: 'display' }); } catch (e) { annots = []; }
        var widgets = annots.filter(function (a) { return a && a.subtype === 'Widget' && a.fieldName; });
        if (widgets.length) {
          var tc = null;
          try { tc = await page.getTextContent(); } catch (e) { tc = { items: [] }; }
          var vp = page.getViewport({ scale: 1 });
          var texts = (tc.items || []).filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
            var x = it.transform[4], y = it.transform[5];
            return { s: it.str.trim(), x0: x, x1: x + (it.width || 0), y: y, h: it.height || Math.abs(it.transform[3]) || 8 };
          });
          widgets.forEach(function (a) {
            var r = a.rect || [0, 0, 0, 0];
            var fx0 = Math.min(r[0], r[2]), fx1 = Math.max(r[0], r[2]), fy0 = Math.min(r[1], r[3]), fy1 = Math.max(r[1], r[3]);
            var type = a.fieldType === 'Tx' ? 'text' : a.fieldType === 'Sig' ? 'signature' : a.fieldType === 'Ch' ? (a.combo ? 'dropdown' : 'option-list') : a.fieldType === 'Btn' ? (a.checkBox ? 'checkbox' : a.radioButton ? 'radio' : 'button') : 'unknown';
            /* nearest printed label: to the left on the same line, else just above */
            var best = null, bestD = 1e9;
            texts.forEach(function (t) {
              var mid = t.y + t.h * 0.35;
              var sameLine = mid >= fy0 - 3 && mid <= fy1 + 3 && t.x1 <= fx0 + 6 && fx0 - t.x1 < 220;
              var above = t.y >= fy1 - 2 && t.y - fy1 < 26 && t.x0 < fx1 && t.x1 > fx0 - 20;
              if (!sameLine && !above) return;
              var dist = sameLine ? fx0 - t.x1 : 40 + (t.y - fy1) + Math.abs(t.x0 - fx0) * 0.2;
              if (dist < bestD) { bestD = dist; best = t; }
            });
            var vr = vp.convertToViewportRectangle(r);
            out.push({
              name: a.fieldName, type: type, page: i - 1,
              tooltip: a.alternativeText || '', label: best ? best.s.replace(/[:*]+$/, '').trim().slice(0, 80) : '',
              maxLen: a.maxLen || 0, multiline: !!a.multiLine, comb: !!a.comb,
              password: !!((a.fieldFlags || 0) & 8192) || !!a.password, readOnly: !!a.readOnly,
              options: (a.options || []).map(function (o) { return o && typeof o === 'object' ? (o.exportValue || o.displayValue || '') : str(o); }),
              exportValue: a.exportValue || a.buttonValue || '',
              value: a.fieldValue == null ? '' : a.fieldValue,
              rect: { x: Math.min(vr[0], vr[2]), y: Math.min(vr[1], vr[3]), w: Math.abs(vr[2] - vr[0]), h: Math.abs(vr[3] - vr[1]) }
            });
          });
        }
        page.cleanup();
        if (i % 4 === 0) await tick();
      }
    } finally { try { pdf.destroy(); } catch (e) {} }
    /* pdf.js reads the tooltip (TU) from the widget only; forms often keep it on the parent field */
    if (out.some(function (f) { return !f.tooltip; })) {
      try {
        var lib = PL(), doc = await lib.PDFDocument.load(u8(bytes).slice(0), { updateMetadata: false });
        var tips = {};
        doc.getForm().getFields().forEach(function (fl) {
          var tu = fl.acroField.dict.lookup(lib.PDFName.of('TU'));
          if (tu && tu.decodeText) tips[fl.getName()] = tu.decodeText();
        });
        out.forEach(function (f) { if (!f.tooltip && tips[f.name]) f.tooltip = tips[f.name]; });
      } catch (e) {}
    }
    var seen = {};
    return out.filter(function (f) { if (seen[f.name]) return false; seen[f.name] = 1; return true; });
  }
  /* A stable id for "this kind of form": field names and types, not the values. */
  async function formFingerprint(fields) {
    var sig = (fields || []).map(function (f) { return f.name + ':' + f.type; }).sort().join('\n');
    return (await sha256(new TextEncoder().encode('lepdf-form\n' + sig))).slice(0, 32);
  }
  var mappings = {
    get: function (fp) { var all = lsGet(MAPS_KEY, {}) || {}; return all[fp] && all[fp].fields ? all[fp].fields : null; },
    /* fields: { fieldName: detailKey | '' (never fill this one) } */
    remember: function (fp, fields) {
      if (!/^[0-9a-f]{16,64}$/.test(str(fp))) return false;
      var all = lsGet(MAPS_KEY, {}) || {};
      var clean = {};
      Object.keys(fields || {}).slice(0, 500).forEach(function (k) {
        if (!safeKey(k)) return;
        var v = str(fields[k]);
        if (v === '' || DETAIL_IDS.indexOf(v) >= 0 || /^(id:\d{1,2}|today|fullName|firstLast|address|cityLine|middleInitial)$/.test(v)) clean[k.slice(0, 200)] = v;
      });
      all[fp] = { at: Date.now(), fields: clean };
      var keys = Object.keys(all);
      if (keys.length > 200) keys.sort(function (a, b) { return all[a].at - all[b].at; }).slice(0, keys.length - 200).forEach(function (k) { delete all[k]; });
      return lsSet(MAPS_KEY, all);
    },
    forget: function (fp) { var all = lsGet(MAPS_KEY, {}) || {}; delete all[fp]; return lsSet(MAPS_KEY, all); },
    count: function () { return Object.keys(lsGet(MAPS_KEY, {}) || {}).length; }
  };
  /* Proposed values for each field. Returns [{ name, type, page, label, key, value, source, skip }]; nothing is written.
     source: 'memory' (a mapping you corrected before), 'name' (field name or tooltip), 'label' (text printed next to it).
     skip: why a field is left alone ('password', 'signature', 'never', 'no-match', 'empty', 'no-option', 'read-only'). */
  function propose(fields, profile, opts) {
    opts = opts || {};
    var memory = opts.memory || null;
    var order = opts.dateOrder || null;
    var today = opts.today || new Date();
    return (fields || []).map(function (f) {
      var row = { name: f.name, type: f.type, page: f.page, label: f.label || f.tooltip || '', key: null, value: '', source: null, skip: null, maxLen: f.maxLen || 0, options: f.options || [] };
      if (f.type === 'signature') { row.skip = 'signature'; return row; }
      if (f.password) { row.skip = 'password'; return row; }
      if (f.readOnly) { row.skip = 'read-only'; return row; }
      if (f.type === 'button' || f.type === 'checkbox') { row.skip = 'no-match'; return row; }
      var byName = classify(f.name + ' ' + (f.tooltip || ''), profile);
      var byLabel = f.label ? classify(f.label, profile) : null;
      if ((byName && byName.never) || (byLabel && byLabel.never && !(byName && byName.key))) { row.skip = 'never'; return row; }
      var hit = byName && byName.key ? byName : byLabel && byLabel.key ? byLabel : null;
      if (hit) { row.key = hit.key; row.source = hit === byName ? 'name' : 'label'; }
      if (memory && own(memory, f.name)) { row.key = memory[f.name] || null; row.source = 'memory'; if (!row.key) { row.skip = 'never'; return row; } }
      if (!row.key) { row.skip = 'no-match'; return row; }
      var hint = (f.name || '') + ' ' + (f.tooltip || '') + ' ' + (f.label || '');
      var v;
      if (row.key === 'today') v = formatDate(isoDate(today), dateOrderFor(hint) || order || localeOrder());
      else if (row.key === 'dob') v = formatDate(profileValue(profile, 'dob'), dateOrderFor(hint) || order || localeOrder());
      else if (row.key === 'middleName' && /initial|\bmi\b/i.test(fieldText(hint))) v = profileValue(profile, 'middleInitial');
      else v = profileValue(profile, row.key);
      if (!v) { row.skip = 'empty'; return row; }
      if (f.type === 'dropdown' || f.type === 'option-list' || f.type === 'radio') {
        var opt = pickOption(f.options, v);
        if (opt == null) { row.skip = 'no-option'; row.value = v; return row; }
        v = opt;
      }
      if (f.maxLen && v.length > f.maxLen) {
        var squeezed = v.replace(/[\s\-]/g, '');
        v = squeezed.length <= f.maxLen ? squeezed : v.slice(0, f.maxLen);
        row.trimmed = true;
      }
      row.value = v;
      return row;
    });
  }
  /* Writes values into the form fields: values { fieldName: string | boolean }. Text the standard font cannot show (Ł, ő,
     Cyrillic…) gets appearances drawn in Plus Jakarta Sans. → Uint8Array with .report { filled, missing, warnings } */
  async function fillFields(input, values, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var doc = await loadDoc(await toBytes(input));
    var form = doc.getForm();
    var report = { filled: [], missing: [], warnings: [] };
    var unicode = false;
    Object.keys(values || {}).forEach(function (name) {
      if (!safeKey(name)) return;
      var v = values[name];
      var field = null;
      try { field = form.getFieldMaybe ? form.getFieldMaybe(name) : form.getField(name); } catch (e) { field = null; }
      if (!field) { report.missing.push(name); return; }
      try {
        if (field instanceof lib.PDFTextField) {
          var t = str(v);
          var max = field.getMaxLength && field.getMaxLength();
          if (max && t.length > max) { t = t.slice(0, max); report.warnings.push('“' + name + '” holds ' + max + ' characters; the value was shortened.'); }
          field.setText(t);
          if (!winAnsiOk(t)) unicode = true;
        } else if (field instanceof lib.PDFCheckBox) { if (v === true || v === 'true' || v === 'Yes' || v === 'On') field.check(); else field.uncheck(); }
        else if (field instanceof lib.PDFDropdown || field instanceof lib.PDFRadioGroup) field.select(str(v));
        else if (field instanceof lib.PDFOptionList) field.select([str(v)]);
        else { report.warnings.push('“' + name + '” cannot be filled automatically.'); return; }
        report.filled.push(name);
      } catch (e) { report.warnings.push('“' + name + '” could not be filled.'); }
    });
    if (unicode) {
      var fonts = await fontsFor(doc);
      try { form.updateFieldAppearances(fonts.sans); } catch (e) { report.warnings.push('Some answers will show once the file is opened in a PDF reader.'); }
    } else {
      try { form.updateFieldAppearances(); } catch (e) {}
    }
    if (opts.flatten) { try { form.flatten(); } catch (e) { report.warnings.push('The form could not be flattened.'); } }
    var out = await doc.save({ updateFieldAppearances: false });
    return withReport(out, report);
  }

  /* =====================================================================
     D14 — compare two versions
     ===================================================================== */

  /* Myers' O((N+M)D) diff on two arrays of strings. Returns ops [[0|-1|1, aIndex, bIndex]] or null when the edit distance
     passes maxD (the caller then falls back to a coarser diff). Common prefix and suffix are trimmed first. */
  function myers(a, b, maxD) {
    var n = a.length, m = b.length, pre = 0, suf = 0;
    while (pre < n && pre < m && a[pre] === b[pre]) pre++;
    while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
    var A = a.slice(pre, n - suf), B = b.slice(pre, m - suf);
    var N = A.length, M = B.length, max = N + M;
    var ops = [], i;
    for (i = 0; i < pre; i++) ops.push([0, i, i]);
    if (max) {
      var limit = Math.min(max, maxD == null ? 4000 : maxD);
      var off = max + 1, v = new Int32Array(2 * max + 3), trace = [], found = -1;
      v[off + 1] = 0;
      for (var D = 0; D <= limit; D++) {
        trace.push(v.slice(off - D - 1, off + D + 2));
        for (var k = -D; k <= D; k += 2) {
          var x = (k === -D || (k !== D && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
          var y = x - k;
          while (x < N && y < M && A[x] === B[y]) { x++; y++; }
          v[off + k] = x;
          if (x >= N && y >= M) { found = D; break; }
        }
        if (found >= 0) break;
      }
      if (found < 0) return null;
      var rev = [], X = N, Y = M;
      for (D = found; D > 0; D--) {
        var tv = trace[D], base = -D - 1;
        var kk = X - Y;
        var get = function (kq) { return tv[kq - base]; };
        var prevK = (kk === -D || (kk !== D && get(kk - 1) < get(kk + 1))) ? kk + 1 : kk - 1;
        var px = get(prevK), py = px - prevK;
        while (X > px && Y > py) { rev.push([0, X - 1, Y - 1]); X--; Y--; }
        if (X === px) rev.push([1, -1, Y - 1]); else rev.push([-1, X - 1, -1]);
        X = px; Y = py;
      }
      while (X > 0 && Y > 0) { rev.push([0, X - 1, Y - 1]); X--; Y--; }
      for (i = rev.length - 1; i >= 0; i--) ops.push([rev[i][0], rev[i][1] < 0 ? -1 : rev[i][1] + pre, rev[i][2] < 0 ? -1 : rev[i][2] + pre]);
    }
    for (i = 0; i < suf; i++) ops.push([0, n - suf + i, m - suf + i]);
    return ops;
  }
  /* Word diff with a fallback for very different texts: diff paragraphs-ish chunks of 12 words, then words inside each changed run. */
  function diffTokens(a, b, opts) {
    var maxD = (opts && opts.maxD) || 3000;
    var ops = myers(a, b, maxD);
    if (ops) return ops;
    var CH = 12;
    function chunks(arr) { var out = []; for (var i = 0; i < arr.length; i += CH) out.push(arr.slice(i, i + CH).join('\u0001')); return out; }
    var ca = chunks(a), cb = chunks(b);
    var cops = myers(ca, cb, maxD) || [];
    var res = [], ai = 0, bi = 0, i = 0;
    while (i < cops.length) {
      if (cops[i][0] === 0) { var ac = cops[i][1] * CH, bc = cops[i][2] * CH; for (var t = 0; t < CH && ac + t < a.length; t++) res.push([0, ac + t, bc + t]); i++; continue; }
      var ra = [], rb = [];
      while (i < cops.length && cops[i][0] !== 0) { if (cops[i][0] < 0) ra.push(cops[i][1]); else rb.push(cops[i][2]); i++; }
      var as = [], bs = [];
      ra.forEach(function (c) { for (var q = c * CH; q < Math.min(a.length, c * CH + CH); q++) as.push(q); });
      rb.forEach(function (c) { for (var q = c * CH; q < Math.min(b.length, c * CH + CH); q++) bs.push(q); });
      var sub = myers(as.map(function (q) { return a[q]; }), bs.map(function (q) { return b[q]; }), 800);
      if (sub) sub.forEach(function (o) { res.push([o[0], o[1] < 0 ? -1 : as[o[1]], o[2] < 0 ? -1 : bs[o[2]]]); });
      else { as.forEach(function (q) { res.push([-1, q, -1]); }); bs.forEach(function (q) { res.push([1, -1, q]); }); }
    }
    return res;
  }

  /* Text of every page as words with positions. Hyphenated line breaks are joined ("agree- ment" → "agreement"). */
  async function readWords(pdf, opts) {
    var pages = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      checkCancel(opts);
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var tc;
      try { tc = await page.getTextContent(); } catch (e) { tc = { items: [] }; }
      var words = [];
      (tc.items || []).forEach(function (it) {
        if (!it || !it.str) return;
        var s = normText(it.str);
        var tx = global.pdfjsLib.Util.transform(vp.transform, it.transform);
        var fontH = Math.hypot(tx[2], tx[3]) || 10;
        var x0 = tx[4], y1 = tx[5], w = (it.width || 0) * vp.scale;
        var re = /\S+/g, m;
        var len = s.length || 1;
        while ((m = re.exec(s))) {
          var wx = x0 + w * (m.index / len), ww = w * (m[0].length / len);
          words.push({ t: m[0], page: p - 1, rect: { x: wx, y: y1 - fontH * 0.85, w: Math.max(1, ww), h: fontH * 1.05 }, line: Math.round(y1) });
        }
      });
      for (var i = words.length - 2; i >= 0; i--) {
        var a = words[i], b = words[i + 1];
        if (/[A-Za-z]-$/.test(a.t) && /^[a-z]/.test(b.t) && b.line !== a.line) {
          a.t = a.t.slice(0, -1) + b.t;
          a.rects = [a.rect, b.rect];
          words.splice(i + 1, 1);
        }
      }
      pages.push({ index: p - 1, width: vp.width, height: vp.height, words: words });
      page.cleanup();
      if (p % 3 === 0) await tick();
    }
    return pages;
  }
  var MONTHS = '(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|januar|februar|marz|juni|juli|oktober|dezember|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)';
  var RE_DATE = new RegExp('\\b(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|' + MONTHS + '\\.? \\d{1,2}(st|nd|rd|th)?,? \\d{4}|\\d{1,2}(st|nd|rd|th)? (of )?' + MONTHS + ',? \\d{4})\\b', 'i');
  var RE_AMOUNT = /([$€£¥₹]|\b(usd|eur|gbp|inr|chf|aud|cad|jpy|rs\.?|dollars?|euros?|pounds?|rupees?)\b)\s?[\d.,]*\d|\d[\d.,]*\s?([$€£¥₹]|\b(usd|eur|gbp|inr|chf|aud|cad|jpy|dollars?|euros?|pounds?|rupees?)\b)|\b\d{1,3}([,.\s]\d{3})+([.,]\d{1,2})?\b/i;
  var RE_PCT = /\d+([.,]\d+)?\s?(%|per ?cent|percent)/i;
  function specialOf(before, after) {
    var both = fold(before + ' || ' + after);
    if (!/\d/.test(before + after)) return null;
    if (RE_AMOUNT.test(before) || RE_AMOUNT.test(after)) return 'amount';
    if (RE_DATE.test(both)) return 'date';
    if (RE_PCT.test(both)) return 'percent';
    return 'number';
  }
  function tokSim(a, b) {
    if (!a.length || !b.length) return 0;
    var ca = {}, inter = 0;
    a.forEach(function (w) { ca[w] = (ca[w] || 0) + 1; });
    b.forEach(function (w) { if (ca[w]) { ca[w]--; inter++; } });
    return 2 * inter / (a.length + b.length);
  }
  function pageSet(list) { var s = {}; list.forEach(function (w) { s[w.page] = 1; }); return Object.keys(s).map(Number).sort(function (x, y) { return x - y; }); }

  /* Changes from a word diff: { id, type: added | removed | replaced | moved, before, after, pagesA, pagesB, rectsA, rectsB, special } */
  /* Diff clean-up so changes read the way a person would mark them up:
     1. a short run of equal words between two larger edits ("the", "will") is folded into one edit;
     2. words common to both sides at the ends of an edit are given back to the equal text;
     3. a pure insertion or deletion slides along repeated words to start at a sentence boundary. */
  function toSegs(ops) {
    var segs = [], cur = null;
    ops.forEach(function (o) {
      var eq = o[0] === 0;
      if (!cur || cur.eq !== eq) {
        var a0 = cur ? cur.a1 : 0, b0 = cur ? cur.b1 : 0;
        cur = { eq: eq, a0: a0, a1: a0, b0: b0, b1: b0 };
        segs.push(cur);
      }
      if (o[0] <= 0) cur.a1++;
      if (o[0] >= 0) cur.b1++;
    });
    return segs;
  }
  function normSegs(segs) {
    var out = [];
    segs.forEach(function (s) {
      if (s.a1 === s.a0 && s.b1 === s.b0) return;
      var last = out[out.length - 1];
      if (last && last.eq === s.eq) { last.a1 = s.a1; last.b1 = s.b1; } else out.push({ eq: s.eq, a0: s.a0, a1: s.a1, b0: s.b0, b1: s.b1 });
    });
    return out;
  }
  function refineSegs(segs, A, B) {
    var i, changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (i = 1; i < segs.length - 1; i++) {
        var s = segs[i], p = segs[i - 1], n = segs[i + 1];
        if (!s.eq || p.eq || n.eq) continue;
        var L = s.a1 - s.a0;
        var ep = Math.max(p.a1 - p.a0, p.b1 - p.b0), en = Math.max(n.a1 - n.a0, n.b1 - n.b0);
        if (L <= 6 && L * 2 <= Math.min(ep, en)) {
          segs.splice(i - 1, 3, { eq: false, a0: p.a0, a1: n.a1, b0: p.b0, b1: n.b1 });
          changed = true;
          break;
        }
      }
    }
    /* give common ends back to the equal text */
    var out = [];
    segs.forEach(function (s) {
      if (s.eq) { out.push(s); return; }
      var a0 = s.a0, a1 = s.a1, b0 = s.b0, b1 = s.b1, pre = 0, suf = 0;
      while (a0 + pre < a1 && b0 + pre < b1 && A[a0 + pre] === B[b0 + pre]) pre++;
      while (a1 - suf > a0 + pre && b1 - suf > b0 + pre && A[a1 - 1 - suf] === B[b1 - 1 - suf]) suf++;
      if (pre) out.push({ eq: true, a0: a0, a1: a0 + pre, b0: b0, b1: b0 + pre });
      out.push({ eq: false, a0: a0 + pre, a1: a1 - suf, b0: b0 + pre, b1: b1 - suf });
      if (suf) out.push({ eq: true, a0: a1 - suf, a1: a1, b0: b1 - suf, b1: b1 });
    });
    segs = normSegs(out);
    /* slide pure insertions and deletions to a sentence boundary */
    function score(W, st, en) {
      var sc = 0;
      if (st === 0 || /[.;:!?)]$/.test(W[st - 1])) sc += 2;
      if (/[.;:!?)]$/.test(W[en - 1])) sc += 1;
      if (/^[A-Z0-9(]/.test(W[st] || '')) sc += 1;
      return sc;
    }
    for (i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (g.eq) continue;
      var ins = g.a0 === g.a1, del = g.b0 === g.b1;
      if (!ins && !del) continue;
      var W = ins ? B : A, st = ins ? g.b0 : g.a0, en = ins ? g.b1 : g.a1;
      var prev = segs[i - 1], next = segs[i + 1];
      var room = prev && prev.eq ? prev.a1 - prev.a0 : 0, roomR = next && next.eq ? next.a1 - next.a0 : 0;
      var left = 0, right = 0;
      while (left < room && W[st - left - 1] === W[en - left - 1]) left++;
      while (right < roomR && W[st + right] === W[en + right]) right++;
      if (!left && !right) continue;
      var best = 0, bestS = score(W, st, en);
      for (var k = -left; k <= right; k++) { var sc = score(W, st + k, en + k); if (sc > bestS) { bestS = sc; best = k; } }
      if (!best) continue;
      var a0 = g.a0, b0 = g.b0;
      g.a0 += best; g.a1 += best; g.b0 += best; g.b1 += best;
      if (prev && prev.eq) { prev.a1 += best; prev.b1 += best; }
      else if (best > 0) { segs.splice(i, 0, { eq: true, a0: a0, a1: a0 + best, b0: b0, b1: b0 + best }); i++; }
      if (next && next.eq) { next.a0 += best; next.b0 += best; }
      else if (best < 0) segs.splice(i + 1, 0, { eq: true, a0: g.a1, a1: g.a1 - best, b0: g.b1, b1: g.b1 - best });
    }
    return normSegs(segs);
  }

  /* Changes from a word diff: { id, type: added | removed | replaced | moved, before, after, pagesA, pagesB, rectsA, rectsB, special } */
  function buildChanges(wa, wb, ops) {
    var TA = wa.map(function (w) { return w.t; }), TB = wb.map(function (w) { return w.t; });
    var segs = refineSegs(normSegs(toSegs(ops)), TA, TB);
    var hunks = [];
    segs.forEach(function (sg, si) {
      if (sg.eq) return;
      var h = { a: [], b: [], before: [], after: [] };
      for (var x = sg.a0; x < sg.a1; x++) h.a.push(x);
      for (x = sg.b0; x < sg.b1; x++) h.b.push(x);
      /* context: the equal words around the change, to read "15 March 2026" when only "15" changed */
      var pv = segs[si - 1], nx = segs[si + 1];
      if (pv && pv.eq) for (x = Math.max(pv.a0, pv.a1 - 3); x < pv.a1; x++) h.before.push([0, x, pv.b0 + (x - pv.a0)]);
      if (nx && nx.eq) for (x = nx.a0; x < Math.min(nx.a1, nx.a0 + 3); x++) h.after.push([0, x, nx.b0 + (x - nx.a0)]);
      hunks.push(h);
    });
    var changes = hunks.map(function (h, n) {
      var A = h.a.map(function (k) { return wa[k]; }), B = h.b.map(function (k) { return wb[k]; });
      var ctxA = h.before.map(function (o) { return wa[o[1]].t; }).join(' '), ctxZ = h.after.map(function (o) { return wa[o[1]].t; }).join(' ');
      var anchorA = h.a.length ? null : (h.before.length ? wa[h.before[h.before.length - 1][1]] : h.after.length ? wa[h.after[0][1]] : null);
      var anchorB = h.b.length ? null : (h.before.length ? wb[h.before[h.before.length - 1][2]] : h.after.length ? wb[h.after[0][2]] : null);
      var before = A.map(function (w) { return w.t; }).join(' '), after = B.map(function (w) { return w.t; }).join(' ');
      var c = {
        id: 'c' + (n + 1), type: A.length && B.length ? 'replaced' : A.length ? 'removed' : 'added',
        before: before, after: after, context: { before: ctxA, after: ctxZ },
        pagesA: A.length ? pageSet(A) : anchorA ? [anchorA.page] : [], pagesB: B.length ? pageSet(B) : anchorB ? [anchorB.page] : [],
        rectsA: [], rectsB: [], words: { a: h.a, b: h.b }, special: null
      };
      A.forEach(function (w) { (w.rects || [w.rect]).forEach(function (r) { c.rectsA.push({ page: w.page, x: r.x, y: r.y, w: r.w, h: r.h }); }); });
      B.forEach(function (w) { (w.rects || [w.rect]).forEach(function (r) { c.rectsB.push({ page: w.page, x: r.x, y: r.y, w: r.w, h: r.h }); }); });
      c.special = specialOf(ctxA + ' ' + before + ' ' + ctxZ, ctxA + ' ' + after + ' ' + ctxZ);
      if (c.special && !/\d/.test(before + after)) c.special = null;
      return c;
    });
    /* moved text: a removed run that reappears as an added run elsewhere (6+ words, at least 85% the same words) */
    var rem = changes.filter(function (c) { return c.words.a.length >= 6; });
    var add = changes.filter(function (c) { return c.words.b.length >= 6; });
    rem.forEach(function (r) {
      var ra = r.words.a.map(function (k) { return wa[k].t; });
      var best = null, bestS = 0.85;
      add.forEach(function (a) {
        if (a === r || a.movedFrom) return;
        var bb = a.words.b.map(function (k) { return wb[k].t; });
        var s = tokSim(ra, bb);
        if (s >= bestS) { bestS = s; best = a; }
      });
      if (!best) return;
      best.movedFrom = r.id;
      r.movedTo = best.id;
      r.moveSimilarity = best.moveSimilarity = Math.round(bestS * 100) / 100;
      if (r.words.b.length === 0) r.type = 'moved';
      if (best.words.a.length === 0) best.type = 'moved';
    });
    /* A pair of moved hunks is reported once: the place it went to; the place it came from keeps a pointer. */
    var byId = {};
    changes.forEach(function (c) { byId[c.id] = c; });
    var out = [];
    changes.forEach(function (c) {
      if (c.type === 'moved' && c.movedTo) {
        var to = byId[c.movedTo];
        if (to && to.type === 'moved') { to.before = c.before; to.pagesA = c.pagesA; to.rectsA = c.rectsA; to.exact = c.moveSimilarity === 1; return; }
      }
      out.push(c);
    });
    out.forEach(function (c, i) { c.id = 'c' + (i + 1); delete c.words; delete c.movedTo; delete c.movedFrom; if (c.type === 'moved') c.special = null; });
    return out;
  }
  /* Small greyscale signature of a page render, for aligning scanned pages. */
  function imageSig(canvas) {
    var c = d.createElement('canvas');
    c.width = 24; c.height = 32;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0, 24, 32);
    var px = g.getImageData(0, 0, 24, 32).data, out = new Float32Array(24 * 32);
    for (var i = 0; i < out.length; i++) out[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
    return out;
  }
  function shingles(words) {
    var s = {};
    for (var i = 0; i + 2 < words.length; i++) s[words[i].t + ' ' + words[i + 1].t + ' ' + words[i + 2].t] = 1;
    if (words.length < 3) words.forEach(function (w) { s[w.t] = 1; });
    return s;
  }
  function pageSim(pa, pb) {
    if (pa.sh && pb.sh && !pa.scanned && !pb.scanned) {
      var ka = Object.keys(pa.sh), inter = 0;
      ka.forEach(function (k) { if (pb.sh[k]) inter++; });
      var uni = ka.length + Object.keys(pb.sh).length - inter;
      return uni ? inter / uni : 1;
    }
    if (pa.img && pb.img) {
      var diff = 0;
      for (var i = 0; i < pa.img.length; i++) diff += Math.abs(pa.img[i] - pb.img[i]);
      return 1 - Math.min(1, diff / pa.img.length * 4);
    }
    return 0;
  }
  /* Page alignment (Needleman–Wunsch): pairs [aIndex | null, bIndex | null] so inserted or removed pages line up. */
  function alignPages(A, B) {
    var n = A.length, m = B.length, GAP = -0.35;
    var S = [], T = [];
    for (var i = 0; i <= n; i++) { S.push(new Float32Array(m + 1)); T.push(new Uint8Array(m + 1)); }
    for (i = 1; i <= n; i++) { S[i][0] = i * GAP; T[i][0] = 1; }
    for (var j = 1; j <= m; j++) { S[0][j] = j * GAP; T[0][j] = 2; }
    for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
      var sim = pageSim(A[i - 1], B[j - 1]);
      var diag = S[i - 1][j - 1] + (sim > 0.2 ? sim : sim - 0.6), up = S[i - 1][j] + GAP, left = S[i][j - 1] + GAP;
      if (diag >= up && diag >= left) { S[i][j] = diag; T[i][j] = 0; } else if (up >= left) { S[i][j] = up; T[i][j] = 1; } else { S[i][j] = left; T[i][j] = 2; }
    }
    var pairs = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      var t = i > 0 && j > 0 ? T[i][j] : i > 0 ? 1 : 2;
      if (t === 0) { pairs.push([i - 1, j - 1]); i--; j--; } else if (t === 1) { pairs.push([i - 1, null]); i--; } else { pairs.push([null, j - 1]); j--; }
    }
    return pairs.reverse();
  }
  async function renderPage(pdf, index, scale) {
    var page = await pdf.getPage(index + 1);
    var vp = page.getViewport({ scale: scale });
    var c = d.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    page.cleanup();
    return c;
  }
  /* Pixel difference of two renders: a heat layer (transparent where equal) and the share of pixels that differ. */
  function visualDiff(ca, cb, opts) {
    opts = opts || {};
    var w = ca.width, h = ca.height;
    var c2 = d.createElement('canvas');
    c2.width = w; c2.height = h;
    var g2 = c2.getContext('2d', { willReadFrequently: true });
    g2.fillStyle = '#fff'; g2.fillRect(0, 0, w, h);
    g2.drawImage(cb, 0, 0, w, h);
    var A = ca.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    var Bd = g2.getImageData(0, 0, w, h).data;
    var heat = d.createElement('canvas');
    heat.width = w; heat.height = h;
    var hg = heat.getContext('2d');
    var out = hg.createImageData(w, h), o = out.data;
    var thr = opts.threshold || 48, changed = 0;
    for (var i = 0; i < A.length; i += 4) {
      var diff = Math.abs(A[i] - Bd[i]) + Math.abs(A[i + 1] - Bd[i + 1]) + Math.abs(A[i + 2] - Bd[i + 2]);
      if (diff > thr) { changed++; o[i] = 230; o[i + 1] = 40; o[i + 2] = 60; o[i + 3] = clamp(90 + diff / 3, 120, 230); }
    }
    hg.putImageData(out, 0, 0);
    return { heat: heat, ratio: changed / (w * h), changedPixels: changed };
  }

  /* compare(oldPdf, newPdf, opts) → { a, b, changes, summary, alignment, scanned, notes }
     a/b: { name, pages, textPages, scannedPages: [index] }. changes as in buildChanges. summary: { count, pages, text, byType,
     special: [{ id, kind, before, after, pageA, pageB }] }. Text is compared where both files have a text layer; pages
     with no text (scans) are listed and can only be compared visually. */
  async function compare(aInput, bInput, opts) {
    opts = opts || {};
    await ready();
    var ba = await toBytes(aInput), bb = await toBytes(bInput);
    var pa = await pdfjsOpen(ba, opts.passwordA), pb = await pdfjsOpen(bb, opts.passwordB);
    try {
      progress(opts, 0, 3, 'Reading the first file');
      var A = await readWords(pa, opts);
      progress(opts, 1, 3, 'Reading the second file');
      var B = await readWords(pb, opts);
      A.forEach(function (p) { p.scanned = p.words.length < 3; p.sh = shingles(p.words); });
      B.forEach(function (p) { p.scanned = p.words.length < 3; p.sh = shingles(p.words); });
      var anyScan = A.some(function (p) { return p.scanned; }) || B.some(function (p) { return p.scanned; });
      if (anyScan && d) {
        for (var i = 0; i < A.length; i++) A[i].img = imageSig(await renderPage(pa, i, 0.25));
        for (i = 0; i < B.length; i++) B[i].img = imageSig(await renderPage(pb, i, 0.25));
      }
      progress(opts, 2, 3, 'Comparing');
      var wa = [], wb = [];
      A.forEach(function (p) { if (!p.scanned) wa = wa.concat(p.words); });
      B.forEach(function (p) { if (!p.scanned) wb = wb.concat(p.words); });
      var ops = diffTokens(wa.map(function (w) { return w.t; }), wb.map(function (w) { return w.t; }), opts);
      var changes = buildChanges(wa, wb, ops);
      var alignment = alignPages(A, B);
      var pagesTouched = {};
      changes.forEach(function (c) { (c.pagesB.length ? c.pagesB : c.pagesA.map(function (x) { return 'a' + x; })).forEach(function (p) { pagesTouched[p] = 1; }); });
      var byType = { added: 0, removed: 0, replaced: 0, moved: 0 };
      changes.forEach(function (c) { byType[c.type]++; });
      var special = changes.filter(function (c) { return c.special && c.type !== 'moved'; }).map(function (c) { return { id: c.id, kind: c.special, before: c.before, after: c.after, contextBefore: c.context.before, contextAfter: c.context.after, pageA: c.pagesA[0], pageB: c.pagesB[0] }; });
      var nPages = Object.keys(pagesTouched).length;
      var notes = [];
      var scanA = A.filter(function (p) { return p.scanned; }).map(function (p) { return p.index; });
      var scanB = B.filter(function (p) { return p.scanned; }).map(function (p) { return p.index; });
      if (scanA.length || scanB.length) notes.push('Some pages have no text layer (they look like scans or pictures). Their words cannot be compared; use the side-by-side and difference views for them.');
      if (A.length !== B.length) notes.push('The files have different page counts (' + A.length + ' and ' + B.length + '). Pages are matched by their content.');
      progress(opts, 3, 3, 'Done');
      return {
        a: { name: opts.nameA || 'Original', pages: A.length, textPages: A.length - scanA.length, scannedPages: scanA, sizes: A.map(function (p) { return { w: p.width, h: p.height }; }) },
        b: { name: opts.nameB || 'New version', pages: B.length, textPages: B.length - scanB.length, scannedPages: scanB, sizes: B.map(function (p) { return { w: p.width, h: p.height }; }) },
        changes: changes,
        alignment: alignment,
        summary: {
          count: changes.length, pages: nPages, byType: byType, special: special,
          text: !changes.length ? (wa.length || wb.length ? 'No differences in the text' : 'Neither file has text to compare') : plural(changes.length, 'change') + ' on ' + plural(nPages, 'page')
        },
        textCompared: !!(wa.length && wb.length),
        notes: notes
      };
    } finally {
      try { pa.destroy(); } catch (e) {}
      try { pb.destroy(); } catch (e) {}
    }
  }
  var TYPE_LABEL = { added: 'Added', removed: 'Removed', replaced: 'Changed', moved: 'Moved' };
  var SPECIAL_LABEL = { amount: 'Amount', date: 'Date', percent: 'Percentage', number: 'Number' };
  var MARK = { added: '#1B7F54', removed: '#B42318', replaced: '#C77700', moved: '#2B59C3' };

  /* A comparison report: a summary (with links) followed by each changed page of both versions with the changes marked. */
  async function compareReport(aInput, bInput, result, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var ba = await toBytes(aInput), bb = await toBytes(bInput);
    if (!result) result = await compare(ba, bb, opts);
    var docA = await loadDoc(ba), docB = await loadDoc(bb);
    var out = await lib.PDFDocument.create();
    var F = await fontsFor(out);
    var hashA = await sha256(ba), hashB = await sha256(bb);
    var W = 595.28, H = 841.89, M = 48;
    /* which page pairs to show */
    var showA = {}, showB = {};
    result.changes.forEach(function (c) {
      c.pagesA.forEach(function (p) { showA[p] = 1; });
      c.pagesB.forEach(function (p) { showB[p] = 1; });
    });
    var pairs = result.alignment.filter(function (pr) { return (pr[0] != null && showA[pr[0]]) || (pr[1] != null && showB[pr[1]]); });
    /* summary pages first (placeholders, filled after the marked pages exist so the links have targets) */
    var lines = [];
    result.changes.forEach(function (c, i) {
      var where = (c.pagesA.length ? 'old p. ' + c.pagesA.map(function (x) { return x + 1; }).join(', ') : '') + (c.pagesA.length && c.pagesB.length ? ' · ' : '') + (c.pagesB.length ? 'new p. ' + c.pagesB.map(function (x) { return x + 1; }).join(', ') : '');
      lines.push({ c: c, n: i + 1, where: where });
    });
    var perFirst = 15, perNext = 20;
    var summaryPages = 1 + Math.max(0, Math.ceil((lines.length - perFirst) / perNext));
    var sp = [];
    for (var s = 0; s < summaryPages; s++) sp.push(out.addPage([W, H]));
    var targetA = {}, targetB = {};
    for (var q = 0; q < pairs.length; q++) {
      var pr = pairs[q];
      if (pr[0] != null) {
        var cpA = (await out.copyPages(docA, [pr[0]]))[0];
        out.addPage(cpA);
        targetA[pr[0]] = cpA;
        markPage(cpA, result.changes, 'a', pr[0], F, 'Old version · page ' + (pr[0] + 1) + ' of ' + result.a.pages);
      }
      if (pr[1] != null) {
        var cpB = (await out.copyPages(docB, [pr[1]]))[0];
        out.addPage(cpB);
        targetB[pr[1]] = cpB;
        markPage(cpB, result.changes, 'b', pr[1], F, 'New version · page ' + (pr[1] + 1) + ' of ' + result.b.pages);
      }
      if (q % 4 === 3) await tick();
    }
    /* write the summary */
    var ink = rgb('#16131C'), muted = rgb('#5E5967');
    var page = sp[0], g = geom(page), y = M + 22;
    drawText(g, 'Comparison report', M, y, 22, F.bold, ink);
    y += 22;
    drawText(g, 'Made with LocalEditor on ' + niceDate() + ' at ' + niceTime() + '. Compared on this device; nothing was uploaded.', M, y, 9, F.sans, muted);
    y += 26;
    [['Old version', result.a.name, ba.length, result.a.pages, hashA], ['New version', result.b.name, bb.length, result.b.pages, hashB]].forEach(function (r) {
      drawText(g, r[0], M, y, 9.5, F.bold, muted);
      drawText(g, trimTo(r[1], 70), M + 80, y, 10.5, F.bold, ink);
      y += 14;
      drawText(g, plural(r[3], 'page') + ' · ' + fmtBytes(r[2]) + ' · SHA-256 ' + shortHash(r[4]), M + 80, y, 9, F.sans, muted);
      y += 18;
    });
    drawRule(g, M, y, W - 2 * M);
    y += 26;
    drawText(g, result.summary.text, M, y, 16, F.bold, ink);
    y += 18;
    var bt = result.summary.byType;
    drawText(g, [bt.replaced ? bt.replaced + ' changed' : '', bt.added ? bt.added + ' added' : '', bt.removed ? bt.removed + ' removed' : '', bt.moved ? bt.moved + ' moved' : ''].filter(Boolean).join(' · ') || 'Nothing changed in the text', M, y, 10, F.sans, muted);
    y += 16;
    if (result.summary.special.length) {
      y += 6;
      drawBox(g, M, y - 2, W - 2 * M, 16 + 14 * Math.min(6, result.summary.special.length), { fill: '#FFF6E0', border: '#E2B15A', borderWidth: 0.6 });
      y += 11;
      drawText(g, 'Numbers, amounts and dates that changed', M + 10, y, 9.5, F.bold, rgb('#6B4A00'));
      result.summary.special.slice(0, 6).forEach(function (sx) {
        y += 14;
        var cb = (sx.contextBefore || '').split(' ').slice(-2).join(' '), ca = (sx.contextAfter || '').split(' ').slice(0, 2).join(' ');
        var was = trimTo([cb, sx.before || '(none)', ca].join(' ').trim(), 42), now = trimTo([cb, sx.after || '(none)', ca].join(' ').trim(), 42);
        drawText(g, SPECIAL_LABEL[sx.kind] + ': ' + was + '  →  ' + now + (sx.pageB != null ? '  (new p. ' + (sx.pageB + 1) + ')' : ''), M + 10, y, 9.5, F.sans, ink);
      });
      y += 14;
    }
    var notes = ['Accuracy: this compares the text layer of the two files word by word. It does not compare pictures, signatures, colours or layout, and it cannot read scanned pages.'].concat(result.notes || []);
    y += 10;
    notes.forEach(function (nt) { wrapLines(F.sans, nt, 8.5, W - 2 * M).forEach(function (ln) { drawText(g, ln, M, y, 8.5, F.sans, muted); y += 11.5; }); });
    y += 10;
    drawRule(g, M, y, W - 2 * M);
    y += 18;
    var si = 0, onPage = 0, cap = perFirst;
    lines.forEach(function (ln) {
      if (onPage >= cap) { si++; page = sp[si]; g = geom(page); y = M + 10; onPage = 0; cap = perNext; }
      var c = ln.c, col = rgb(MARK[c.type]);
      drawText(g, String(ln.n), M, y, 9, F.bold, muted);
      drawText(g, TYPE_LABEL[c.type] + (c.special ? ' · ' + SPECIAL_LABEL[c.special] : ''), M + 22, y, 9, F.bold, col);
      drawText(g, ln.where, W - M - widthOf(F.sans, ln.where, 8.5), y, 8.5, F.sans, muted);
      var target = c.pagesB.length && targetB[c.pagesB[0]] ? targetB[c.pagesB[0]] : c.pagesA.length && targetA[c.pagesA[0]] ? targetA[c.pagesA[0]] : null;
      if (target) addLink(out, page, g.rect(M, y - 10, W - 2 * M, 34), target);
      y += 12;
      var txt = c.type === 'added' ? '+ ' + c.after : c.type === 'removed' ? '− ' + c.before : c.type === 'moved' ? 'Moved: ' + c.after : c.before + '  →  ' + c.after;
      drawText(g, trimTo(txt, 110), M + 22, y, 9, F.sans, ink);
      y += 20;
      onPage++;
    });
    if (!lines.length) drawText(g, 'No changes to list.', M, y, 10, F.sans, muted);
    sp.forEach(function (p, i) { var gg = geom(p); drawText(gg, 'Comparison report · ' + (i + 1) + ' of ' + summaryPages, M, H - 24, 8, F.sans, muted); });
    out.setTitle('Comparison report: ' + result.a.name + ' and ' + result.b.name);
    out.setProducer('LocalEditor');
    out.setCreator('LocalEditor');
    return withReport(await out.save(), { pages: out.getPageCount(), summaryPages: summaryPages, markedPages: pairs.length });
  }
  function markPage(page, changes, side, index, F, label) {
    var g = geom(page);
    changes.forEach(function (c) {
      var rects = side === 'a' ? c.rectsA : c.rectsB;
      var col = side === 'a' && c.type === 'replaced' ? MARK.removed : MARK[c.type];
      if (side === 'a' && c.type === 'added') return;
      if (side === 'b' && c.type === 'removed') return;
      rects.forEach(function (r) {
        if (r.page !== index) return;
        drawBox(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, { fill: col, opacity: 0.22, border: col, borderWidth: 0.8, borderOpacity: 0.8 });
      });
    });
    var w = widthOf(F.bold, label, 8.5) + 16;
    drawBox(g, 0, 0, w, 18, { fill: side === 'a' ? '#FDECEC' : '#E8F5EE', opacity: 0.95 });
    drawText(g, label, 8, 12.5, 8.5, F.bold, rgb(side === 'a' ? '#8A1C12' : '#13603F'));
  }

  /* =====================================================================
     D15 — bundle builder
     ===================================================================== */

  var NUM_FORMATS = { 'n': function (n) { return String(n); }, 'page-n': function (n) { return 'Page ' + n; }, 'n-of-N': function (n, N) { return n + ' of ' + N; }, 'page-n-of-N': function (n, N) { return 'Page ' + n + ' of ' + N; }, 'n/N': function (n, N) { return n + ' / ' + N; }, '-n-': function (n) { return '– ' + n + ' –'; } };
  var POSITIONS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
  var PAPER = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
  function posXY(g, pos, textW, size, margin) {
    var col = pos.charAt(1), row = pos.charAt(0);
    var x = col === 'l' ? margin : col === 'r' ? g.w - margin - textW : (g.w - textW) / 2;
    var y = row === 't' ? margin + size * 0.8 : g.h - margin + size * 0.1;
    return { x: x, y: y };
  }
  function tokens(text, info) {
    return str(text).replace(/\{page\}/g, info.page).replace(/\{pages\}/g, info.pages).replace(/\{title\}/g, info.title || '').replace(/\{date\}/g, info.date || niceDate()).replace(/\{file\}/g, info.file || '').replace(/\{section\}/g, info.section || '');
  }
  /* Page numbers, header/footer and Bates numbers on an existing document.
     cfg: { numbers: { position, format, start, skip, size, color }, header: { left, center, right }, footer: {…},
            bates: { prefix, start, digits, position }, title, skip (pages from the start that get nothing), labels: per-page info } */
  async function stampChrome(doc, cfg) {
    cfg = cfg || {};
    var F = await fontsFor(doc);
    var pages = doc.getPages();
    var skip = clamp(num(cfg.skip, 0) | 0, 0, pages.length);
    var nums = cfg.numbers, bates = cfg.bates;
    var start = nums ? Math.max(0, num(nums.start, 1) | 0) : 1;
    var total = pages.length - skip;
    var printed = [];
    pages.forEach(function (page, i) {
      if (i < skip) { printed.push(null); return; }
      var g = geom(page);
      var n = start + (i - skip), N = start + total - 1;
      var info = { page: String(n), pages: String(N), title: cfg.title, date: cfg.date, file: (cfg.files && cfg.files[i]) || '', section: (cfg.sections && cfg.sections[i]) || '' };
      var line = {};
      var margin = num(cfg.margin, 24);
      if (nums) {
        var fmt = NUM_FORMATS[nums.format] || NUM_FORMATS['n'];
        var label = fmt(n, N);
        var size = clamp(num(nums.size, 9.5), 6, 24);
        var pos = POSITIONS.indexOf(nums.position) >= 0 ? nums.position : 'bc';
        var at = posXY(g, pos, widthOf(F.sans, label, size), size, margin);
        drawText(g, label, at.x, at.y, size, F.sans, rgb(nums.color || '#3A3640'));
        line.number = label;
      }
      ['header', 'footer'].forEach(function (k) {
        var hf = cfg[k];
        if (!hf) return;
        ['left', 'center', 'right'].forEach(function (slot) {
          if (!hf[slot]) return;
          var t = tokens(hf[slot], info);
          var sz = clamp(num(hf.size, 8.5), 6, 18);
          var p = (k === 'header' ? 't' : 'b') + slot.charAt(0);
          var at2 = posXY(g, p, widthOf(F.sans, t, sz), sz, margin);
          if (nums && p === (nums.position || 'bc')) at2.y += k === 'header' ? sz * 1.5 : -sz * 1.5;
          drawText(g, t, at2.x, at2.y, sz, F.sans, rgb(hf.color || '#5E5967'));
        });
      });
      if (bates) {
        var digits = clamp(num(bates.digits, 6) | 0, 1, 12);
        var bn = String(Math.max(0, num(bates.start, 1) | 0) + (i - skip));
        while (bn.length < digits) bn = '0' + bn;
        var bl = str(bates.prefix).slice(0, 24) + bn;
        var bsz = clamp(num(bates.size, 8.5), 6, 16);
        var bpos = POSITIONS.indexOf(bates.position) >= 0 ? bates.position : 'br';
        var at3 = posXY(g, bpos, widthOf(F.mono, bl, bsz), bsz, margin);
        if (nums && bpos === (nums.position || 'bc')) at3.y += bpos.charAt(0) === 't' ? bsz * 1.6 : -bsz * 1.6;
        drawText(g, bl, at3.x, at3.y, bsz, F.mono, rgb('#222026'));
        line.bates = bl;
      }
      printed.push(line);
    });
    return printed;
  }
  async function imageToPdfPage(out, bytes, paper) {
    var lib = PL();
    var kind = bytes[0] === 0xFF && bytes[1] === 0xD8 ? 'jpg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : null;
    var img;
    if (kind === 'jpg') img = await out.embedJpg(bytes);
    else if (kind === 'png') img = await out.embedPng(bytes);
    else {
      if (!d) throw new Error('This image type needs a browser to convert');
      var blob = new Blob([bytes]);
      var bmp = await createImageBitmap(blob);
      var c = d.createElement('canvas');
      var sc = Math.min(1, 4000 / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      var png = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.9); });
      img = await out.embedJpg(new Uint8Array(await png.arrayBuffer()));
    }
    var land = img.width > img.height;
    var pw = land ? paper[1] : paper[0], ph = land ? paper[0] : paper[1], m = 36;
    var s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
    var page = out.addPage([pw, ph]);
    page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
    return page;
  }
  /* bundle(plan, opts) → Uint8Array with .report { pages, toc: [{ title, page, level }], outline, numbering }
     plan: { items: [{ kind: 'pdf' | 'image', name, bytes, title?, pages? ('1-3,5') } | { kind: 'divider', title, subtitle? }],
             cover: { title, subtitle, date, preparedBy, preparedFor, logo (image bytes) } | null,
             toc: { title } | true | false, bookmarks: true, keepOutlines: true,
             numbering: { position, format, start, skipCover: true, skipToc: true, size } | null,
             header: { left, center, right } | null, footer: {…} | null, bates: { prefix, start, digits, position } | null,
             paper: 'a4' | 'letter' | 'legal', title } */
  async function bundle(plan, opts) {
    opts = opts || {};
    plan = plan || {};
    await ready();
    var lib = PL();
    var items = (plan.items || []).filter(function (it) { return it && (it.kind === 'divider' || it.bytes); });
    if (!items.some(function (it) { return it.kind !== 'divider'; })) throw new Error('Add at least one PDF or image to the pack.');
    var paper = PAPER[plan.paper] || PAPER.a4;
    var out = await lib.PDFDocument.create();
    var F = await fontsFor(out);
    var ink = rgb('#16131C'), muted = rgb('#5E5967');
    var report = { toc: [], warnings: [], outline: 0 };
    var hasCover = !!(plan.cover && (plan.cover.title || plan.cover.subtitle || plan.cover.logo));
    var tocOn = plan.toc !== false && plan.toc != null;
    var tocTitle = (plan.toc && plan.toc.title) || 'Contents';
    /* 1. load everything and count pages */
    var loaded = [];
    for (var i = 0; i < items.length; i++) {
      checkCancel(opts);
      var it = items[i];
      progress(opts, i, items.length * 2, 'Reading ' + (it.name || it.title || 'item ' + (i + 1)));
      if (it.kind === 'divider') { loaded.push({ it: it, count: 1 }); continue; }
      var bytes = await toBytes(it.bytes);
      if (it.kind === 'image') { loaded.push({ it: it, bytes: bytes, count: 1 }); continue; }
      var src = await loadDoc(bytes);
      var idx = src.getPageIndices();
      if (it.pages && LE.pdf && LE.pdf.parseRanges) {
        var pr = LE.pdf.parseRanges(it.pages, idx.length);
        if (pr.pages.length) idx = pr.pages.map(function (n) { return n - 1; });
      }
      var outline = [];
      if (plan.keepOutlines !== false) {
        try { var pj = await pdfjsOpen(bytes); outline = await readOutline(pj); pj.destroy(); } catch (e) { outline = []; }
      }
      loaded.push({ it: it, src: src, idx: idx, count: idx.length, outline: outline });
    }
    var tocEntries = loaded.length;
    var TOC_PER = 26;
    var tocPages = tocOn ? Math.max(1, Math.ceil(tocEntries / TOC_PER)) : 0;
    var front = (hasCover ? 1 : 0) + tocPages;
    var bodyPages = loaded.reduce(function (s, l) { return s + l.count; }, 0);
    if (front + bodyPages > MAX_BUNDLE_PAGES) throw new Error('A pack can have up to ' + MAX_BUNDLE_PAGES + ' pages.');
    /* numbering decides the printed number of each physical page */
    var nb = plan.numbering || null;
    var skipN = 0;
    if (nb) { if (nb.skipCover !== false && hasCover) skipN++; if (nb.skipToc !== false && tocOn) skipN += tocPages; }
    var startN = nb ? Math.max(0, num(nb.start, 1) | 0) : 1;
    function printedNumber(physical) { return nb ? (physical < skipN ? null : startN + physical - skipN) : physical + 1; }
    /* 2. cover */
    if (hasCover) {
      var cover = out.addPage(paper.slice());
      var cg = geom(cover), cy = 150, M = 64;
      var cv = plan.cover;
      if (cv.logo) {
        try {
          var lb = await toBytes(cv.logo);
          var limg = lb[0] === 0xFF ? await out.embedJpg(lb) : await out.embedPng(lb);
          var ls = Math.min(150 / limg.width, 70 / limg.height, 1.5);
          var lpos = cg.pt(M, 70 + limg.height * ls);
          cover.drawImage(limg, { x: lpos.x, y: lpos.y, width: limg.width * ls, height: limg.height * ls });
        } catch (e) { report.warnings.push('The logo could not be used (use a PNG or JPEG).'); }
      }
      cy = 250;
      drawRule(cg, M, cy - 40, 64, '#E2B15A', 3);
      wrapLines(F.serif, cv.title || 'Document pack', 30, cg.w - 2 * M).slice(0, 4).forEach(function (ln) { drawText(cg, ln, M, cy, 30, F.serif, ink); cy += 38; });
      if (cv.subtitle) { cy += 2; wrapLines(F.sans, cv.subtitle, 14, cg.w - 2 * M).slice(0, 4).forEach(function (ln) { drawText(cg, ln, M, cy, 14, F.sans, muted); cy += 20; }); }
      var meta = [];
      if (cv.preparedFor) meta.push(['Prepared for', cv.preparedFor]);
      if (cv.preparedBy) meta.push(['Prepared by', cv.preparedBy]);
      if (cv.date !== false) meta.push(['Date', cv.date && cv.date !== 'today' ? cv.date : niceDate()]);
      var my = cg.h - 90 - meta.length * 34;
      meta.forEach(function (m2) {
        drawText(cg, m2[0].toUpperCase(), M, my, 8, F.bold, muted);
        drawText(cg, trimTo(m2[1], 80), M, my + 15, 12, F.sans, ink);
        my += 34;
      });
    }
    /* 3. contents placeholders */
    var tocPageObjs = [];
    for (i = 0; i < tocPages; i++) tocPageObjs.push(out.addPage(paper.slice()));
    /* 4. body */
    var outlineNodes = [], currentSection = null, files = [], sections = [];
    for (i = 0; i < front; i++) { files.push(''); sections.push(''); }
    for (i = 0; i < loaded.length; i++) {
      checkCancel(opts);
      var L = loaded[i];
      progress(opts, items.length + i, items.length * 2, 'Adding ' + (L.it.name || L.it.title || 'item ' + (i + 1)));
      var title = L.it.title || baseName(L.it.name) || (L.it.kind === 'divider' ? 'Section' : 'Document');
      var firstPage;
      if (L.it.kind === 'divider') {
        var dp = out.addPage(paper.slice());
        var dg = geom(dp);
        drawRule(dg, 64, dg.h / 2 - 50, 48, '#E2B15A', 3);
        wrapLines(F.serif, title, 26, dg.w - 128).slice(0, 3).forEach(function (ln, k) { drawText(dg, ln, 64, dg.h / 2 - 10 + k * 32, 26, F.serif, ink); });
        if (L.it.subtitle) drawText(dg, trimTo(L.it.subtitle, 90), 64, dg.h / 2 + 30, 12, F.sans, muted);
        firstPage = dp;
        currentSection = { title: title, page: dp, children: [] };
        outlineNodes.push(currentSection);
        files.push(''); sections.push(title);
        L.first = out.getPageCount() - 1;
        report.toc.push({ title: title, page: printedNumber(L.first), physical: L.first, level: 0, kind: 'divider' });
        continue;
      }
      if (L.it.kind === 'image') {
        firstPage = await imageToPdfPage(out, L.bytes, paper);
        L.first = out.getPageCount() - 1;
        files.push(L.it.name || ''); sections.push(currentSection ? currentSection.title : '');
      } else {
        var copied = await out.copyPages(L.src, L.idx);
        copied.forEach(function (p) { out.addPage(p); files.push(L.it.name || ''); sections.push(currentSection ? currentSection.title : ''); });
        firstPage = copied[0];
        L.first = out.getPageCount() - copied.length;
        L.pages = copied;
      }
      var node = { title: title, page: firstPage, children: [] };
      if (L.outline && L.outline.length && L.pages) {
        var posOf = {};
        L.idx.forEach(function (orig, k) { posOf[orig] = k; });
        var mapNodes = function (list) {
          return list.map(function (o) {
            var k = o.page != null && posOf[o.page] != null ? posOf[o.page] : null;
            return k == null ? null : { title: o.title, page: L.pages[k], children: mapNodes(o.children || []), open: false };
          }).filter(Boolean);
        };
        node.children = mapNodes(L.outline);
        node.open = false;
      }
      (currentSection ? currentSection.children : outlineNodes).push(node);
      report.toc.push({ title: title, page: printedNumber(L.first), physical: L.first, level: currentSection ? 1 : 0, kind: L.it.kind });
      if (i % 3 === 2) await tick();
    }
    /* 5. contents */
    if (tocOn) {
      var all = out.getPages();
      report.toc.forEach(function (e, k) {
        var tp = tocPageObjs[Math.floor(k / TOC_PER)];
        var tg = geom(tp), row = k % TOC_PER, M2 = 64;
        if (row === 0) {
          drawText(tg, k === 0 ? tocTitle : tocTitle + ' (continued)', M2, 96, 22, F.serif, ink);
          drawRule(tg, M2, 112, tg.w - 2 * M2);
        }
        var y = 146 + row * 24;
        var indent = e.level ? 18 : 0;
        var font = e.level ? F.sans : F.bold;
        var label = e.page == null ? '' : String(e.page);
        var maxT = tg.w - 2 * M2 - indent - 50;
        var t = e.title;
        while (widthOf(font, t, 11) > maxT && t.length > 4) t = t.slice(0, -2);
        if (t !== e.title) t = t.replace(/.$/, '…');
        drawText(tg, t, M2 + indent, y, 11, font, ink);
        var tw = widthOf(font, t, 11), lw = widthOf(F.sans, label, 11);
        var dots = '';
        var dotW = widthOf(F.sans, '.', 11) || 3;
        var gap = tg.w - M2 - lw - (M2 + indent + tw) - 12;
        if (gap > dotW * 3) dots = new Array(Math.floor(gap / dotW)).join('.');
        if (dots) drawText(tg, dots, M2 + indent + tw + 6, y, 11, F.sans, rgb('#B9B4AC'));
        drawText(tg, label, tg.w - M2 - lw, y, 11, F.sans, ink);
        addLink(out, tp, tg.rect(M2 + indent - 2, y - 14, tg.w - 2 * M2 - indent + 4, 20), all[e.physical]);
      });
      outlineNodes.unshift({ title: tocTitle, page: tocPageObjs[0], children: [] });
    }
    if (hasCover) outlineNodes.unshift({ title: (plan.cover.title ? 'Cover: ' + plan.cover.title : 'Cover'), page: out.getPage(0), children: [] });
    /* 6. numbering, header/footer, Bates */
    var chrome = null;
    if (nb || plan.header || plan.footer || plan.bates) {
      chrome = await stampChrome(out, {
        numbers: nb, header: plan.header, footer: plan.footer, bates: plan.bates, skip: nb ? skipN : (hasCover ? 1 : 0),
        title: plan.title || (plan.cover && plan.cover.title) || '', files: files, sections: sections
      });
    }
    if (plan.bookmarks !== false) report.outline = setOutline(out, outlineNodes);
    out.setTitle(plan.title || (plan.cover && plan.cover.title) || 'Document pack');
    out.setProducer('LocalEditor');
    out.setCreator('LocalEditor');
    report.pages = out.getPageCount();
    report.front = front;
    report.numbers = chrome ? chrome.map(function (c) { return c && c.number || null; }) : [];
    report.bates = chrome ? chrome.map(function (c) { return c && c.bates || null; }) : [];
    progress(opts, 1, 1, 'Done');
    return withReport(await out.save(), report);
  }
  /* The same plan, without building: page ranges per item, for the preview. */
  async function bundlePlan(plan) {
    await ready();
    var items = (plan && plan.items) || [];
    var hasCover = !!(plan.cover && (plan.cover.title || plan.cover.subtitle || plan.cover.logo));
    var tocOn = plan.toc !== false && plan.toc != null;
    var tocPages = tocOn ? Math.max(1, Math.ceil(items.length / 26)) : 0;
    var at = (hasCover ? 1 : 0) + tocPages;
    var nb = plan.numbering;
    var skipN = nb ? (nb.skipCover !== false && hasCover ? 1 : 0) + (nb.skipToc !== false ? tocPages : 0) : 0;
    var startN = nb ? Math.max(0, num(nb.start, 1) | 0) : 1;
    var rows = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i], count = 1;
      if (it.kind === 'pdf' && it.bytes) {
        try {
          var doc = await loadDoc(await toBytes(it.bytes));
          count = doc.getPageCount();
          if (it.pages && LE.pdf && LE.pdf.parseRanges) { var pr = LE.pdf.parseRanges(it.pages, count); if (pr.pages.length) count = pr.pages.length; }
        } catch (e) { count = 0; rows.push({ title: it.title || it.name, error: e.message, from: null, to: null }); continue; }
      }
      var from = at, to = at + count - 1;
      rows.push({ title: it.title || baseName(it.name) || 'Section', kind: it.kind, count: count, from: nb ? (from < skipN ? null : startN + from - skipN) : from + 1, to: nb ? (to < skipN ? null : startN + to - skipN) : to + 1, physicalFrom: from + 1 });
      at += count;
    }
    return { cover: hasCover, tocPages: tocPages, total: at, rows: rows };
  }

  /* =====================================================================
     D16 — stamps and comment summary
     ===================================================================== */

  var STAMP_PRESETS = [
    { id: 'approved', text: 'APPROVED', color: '#1B7F54' }, { id: 'paid', text: 'PAID', color: '#1B7F54' },
    { id: 'received', text: 'RECEIVED', color: '#1D4ED8' }, { id: 'reviewed', text: 'REVIEWED', color: '#1D4ED8' },
    { id: 'draft', text: 'DRAFT', color: '#5E5967' }, { id: 'copy', text: 'COPY', color: '#5E5967' },
    { id: 'confidential', text: 'CONFIDENTIAL', color: '#B42318' }, { id: 'void', text: 'VOID', color: '#B42318' }
  ];
  function stampSpec(spec) {
    spec = spec || {};
    var pre = STAMP_PRESETS.filter(function (p) { return p.id === spec.preset; })[0];
    var text = cleanText(spec.text != null && spec.text !== '' ? spec.text : pre ? pre.text : 'APPROVED', 40).toUpperCase();
    var color = /^#[0-9a-f]{6}$/i.test(str(spec.color)) ? spec.color : pre ? pre.color : '#1B7F54';
    var shape = ['rounded', 'box', 'oval', 'plain'].indexOf(spec.shape) >= 0 ? spec.shape : 'rounded';
    var when = spec.when ? new Date(spec.when) : new Date();
    if (isNaN(when.getTime())) when = new Date();
    var sub = [];
    if (spec.name) sub.push(cleanText(spec.name, 60));
    if (spec.date) sub.push(niceDate(when));
    if (spec.time) sub.push(niceTime(when));
    return { text: text || 'STAMP', color: color, shape: shape, sub: sub.join(' · '), angle: clamp(num(spec.angle, -8), -30, 30) };
  }
  /* A stamp as a picture, for placing as an object in the studio (it becomes page content when the PDF is saved). */
  function stampCanvas(spec, scale) {
    var s = stampSpec(spec);
    scale = scale || 3;
    var font = '"Plus Jakarta Sans", system-ui, sans-serif';
    var probe = d.createElement('canvas').getContext('2d');
    probe.font = '800 30px ' + font;
    var tw = probe.measureText(s.text).width + s.text.length * 3;
    probe.font = '600 11px ' + font;
    var sw = s.sub ? probe.measureText(s.sub).width : 0;
    var w = Math.max(tw, sw) + 36, h = s.sub ? 70 : 52;
    var rad = s.angle * Math.PI / 180;
    var bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)), bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    var c = d.createElement('canvas');
    c.width = Math.ceil(bw * scale); c.height = Math.ceil(bh * scale);
    var g = c.getContext('2d');
    g.scale(scale, scale);
    g.translate(bw / 2, bh / 2);
    g.rotate(rad);
    g.translate(-w / 2, -h / 2);
    g.strokeStyle = s.color; g.fillStyle = s.color;
    g.globalAlpha = 0.92;
    if (s.shape !== 'plain') {
      g.lineWidth = 3;
      g.beginPath();
      if (s.shape === 'oval') g.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
      else if (s.shape === 'box') g.rect(2, 2, w - 4, h - 4);
      else { var r = 10; g.moveTo(2 + r, 2); g.arcTo(w - 2, 2, w - 2, h - 2, r); g.arcTo(w - 2, h - 2, 2, h - 2, r); g.arcTo(2, h - 2, 2, 2, r); g.arcTo(2, 2, w - 2, 2, r); g.closePath(); }
      g.stroke();
      if (s.shape === 'rounded') { g.lineWidth = 1; g.beginPath(); var r2 = 7; g.moveTo(7 + r2, 7); g.arcTo(w - 7, 7, w - 7, h - 7, r2); g.arcTo(w - 7, h - 7, 7, h - 7, r2); g.arcTo(7, h - 7, 7, 7, r2); g.arcTo(7, 7, w - 7, 7, r2); g.closePath(); g.stroke(); }
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = '800 30px ' + font;
    if ('letterSpacing' in g) g.letterSpacing = '3px';
    g.fillText(s.text, w / 2 + 1.5, s.sub ? 38 : 36);
    if (s.sub) { if ('letterSpacing' in g) g.letterSpacing = '0px'; g.font = '600 11px ' + font; g.fillText(s.sub, w / 2, 56); }
    c.stampWidth = bw; c.stampHeight = bh;
    return c;
  }
  /* Vector stamp drawn into the page content of every chosen page.
     opts: { pages: 'all' | 'first' | 'last' | [indexes], position: 'tr' | 'tl' | 'tc' | 'cc' | 'bl' | 'bc' | 'br' | { x, y } (visual points), width } */
  async function stampPages(input, spec, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var doc = await loadDoc(await toBytes(input));
    var F = await fontsFor(doc);
    var s = stampSpec(spec);
    var pages = doc.getPages();
    var which = opts.pages || 'all';
    var list = which === 'first' ? [0] : which === 'last' ? [pages.length - 1] : Array.isArray(which) ? which.filter(function (i) { return i >= 0 && i < pages.length; }) : pages.map(function (p, i) { return i; });
    var color = rgb(s.color);
    list.forEach(function (pi) {
      var page = pages[pi], g = geom(page);
      var size = clamp(num(opts.size, 20), 8, 72);
      var tw = widthOf(F.bold, s.text, size) + s.text.length * size * 0.08;
      var subSize = size * 0.42, subW = s.sub ? widthOf(F.sans, s.sub, subSize) : 0;
      var w = Math.max(tw, subW) + size * 1.1, h = size * (s.sub ? 2.2 : 1.6);
      var pos = opts.position || 'tr', m = 30, x, y;
      if (pos && typeof pos === 'object') { x = num(pos.x, m); y = num(pos.y, m); }
      else {
        var col = pos.charAt(1), row = pos.charAt(0);
        x = col === 'l' ? m : col === 'r' ? g.w - m - w : (g.w - w) / 2;
        y = row === 't' ? m : row === 'b' ? g.h - m - h : (g.h - h) / 2;
      }
      if (s.shape !== 'plain') {
        var bl = g.pt(x, y + h);
        var o = { x: bl.x, y: bl.y, width: w, height: h, borderColor: color, borderWidth: Math.max(1.2, size * 0.09), borderOpacity: 0.9, rotate: lib.degrees(g.rot) };
        if (s.shape === 'oval') { var cc = g.pt(x + w / 2, y + h / 2); page.drawEllipse({ x: cc.x, y: cc.y, xScale: w / 2, yScale: h / 2, borderColor: color, borderWidth: o.borderWidth, borderOpacity: 0.9 }); }
        else page.drawRectangle(o);
      }
      var cx = x + (w - tw) / 2;
      var ty = y + size * (s.sub ? 1.05 : 1.12);
      var p = g.pt(cx, ty);
      page.drawText(safeFor(F.bold, s.text), { x: p.x, y: p.y, size: size, font: F.bold, color: color, opacity: 0.92, rotate: lib.degrees(g.rot) });
      if (s.sub) drawText(g, s.sub, x + (w - subW) / 2, y + h - size * 0.38, subSize, F.sans, color, { opacity: 0.92 });
    });
    return withReport(await doc.save(), { pages: list.map(function (i) { return i + 1; }), text: s.text, sub: s.sub });
  }

  var COMMENT_TYPES = { Text: 'Note', FreeText: 'Text box', Highlight: 'Highlight', Underline: 'Underline', StrikeOut: 'Strike-through', Squiggly: 'Squiggly underline', Ink: 'Drawing', Square: 'Rectangle', Circle: 'Oval', Line: 'Line', Polygon: 'Polygon', PolyLine: 'Lines', Stamp: 'Stamp', Caret: 'Insert mark', FileAttachment: 'Attached file', Sound: 'Sound' };
  function pdfDate(s) {
    var m = /D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(str(s));
    if (!m) return null;
    var dt = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0));
    return isNaN(dt.getTime()) ? null : dt;
  }
  /* Every comment, note, highlight and markup annotation: [{ id, page, type, subtype, author, date (ISO), text, excerpt, replyTo }] */
  async function comments(input, opts) {
    await ready();
    var pdf = await pdfjsOpen(await toBytes(input), opts && opts.password);
    var out = [];
    try {
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var annots = [];
        try { annots = await page.getAnnotations({ intent: 'display' }); } catch (e) { annots = []; }
        var marks = annots.filter(function (a) { return a && COMMENT_TYPES[a.subtype]; });
        if (marks.length) {
          var tc = null;
          if (marks.some(function (a) { return a.quadPoints || /Highlight|Underline|StrikeOut|Squiggly/.test(a.subtype); })) {
            try { tc = await page.getTextContent(); } catch (e) { tc = null; }
          }
          marks.forEach(function (a) {
            var excerpt = '';
            if (tc && /Highlight|Underline|StrikeOut|Squiggly/.test(a.subtype)) {
              var quads = [];
              var qp = a.quadPoints;
              if (qp && qp.length) {
                if (typeof qp[0] === 'number') { for (var k = 0; k + 7 < qp.length; k += 8) quads.push([Math.min(qp[k], qp[k + 2], qp[k + 4], qp[k + 6]), Math.min(qp[k + 1], qp[k + 3], qp[k + 5], qp[k + 7]), Math.max(qp[k], qp[k + 2], qp[k + 4], qp[k + 6]), Math.max(qp[k + 1], qp[k + 3], qp[k + 5], qp[k + 7])]); }
                else qp.forEach(function (q) { var xs = q.map(function (p) { return p.x; }), ys = q.map(function (p) { return p.y; }); quads.push([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)]); });
              }
              if (!quads.length && a.rect) quads.push([a.rect[0], a.rect[1], a.rect[2], a.rect[3]]);
              var parts = [];
              (tc.items || []).forEach(function (it) {
                if (!it.str || !it.str.trim()) return;
                var x0 = it.transform[4], y0 = it.transform[5], w = it.width || 0, hh = it.height || 8;
                quads.forEach(function (q) {
                  var cy = y0 + hh * 0.4;
                  if (cy < q[1] - 1 || cy > q[3] + 1) return;
                  var lo = Math.max(x0, q[0]), hi = Math.min(x0 + w, q[2]);
                  if (hi - lo < 1) return;
                  var s0 = it.str, n = s0.length;
                  var a0 = w ? Math.round((lo - x0) / w * n) : 0, a1 = w ? Math.round((hi - x0) / w * n) : n;
                  parts.push(s0.slice(a0, a1));
                });
              });
              excerpt = parts.join(' ').replace(/\s+/g, ' ').trim();
            }
            var date = pdfDate(a.modificationDate || a.creationDate);
            out.push({
              id: a.id || '', page: i - 1, subtype: a.subtype, type: COMMENT_TYPES[a.subtype],
              author: (a.titleObj && a.titleObj.str) || a.title || '', date: date ? date.toISOString() : '',
              text: ((a.contentsObj && a.contentsObj.str) || a.contents || '').trim(), excerpt: excerpt, replyTo: a.inReplyTo || null
            });
          });
        }
        page.cleanup();
        if (i % 4 === 0) await tick();
      }
    } finally { try { pdf.destroy(); } catch (e) {} }
    return out;
  }
  function csvCell(v) { v = str(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function commentsCsv(list) {
    var rows = [['Page', 'Type', 'Author', 'Date', 'Comment', 'Highlighted text', 'Reply to']];
    (list || []).forEach(function (c) { rows.push([c.page + 1, c.type, c.author, c.date ? c.date.slice(0, 16).replace('T', ' ') : '', c.text, c.excerpt, c.replyTo || '']); });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  /* A tidy summary of comments. opts.mode: 'append' (summary pages added after the document, each entry linking to its
     page) or 'separate' (a new PDF with only the summary). → Uint8Array with .report { comments, pages } */
  async function commentSummary(input, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var bytes = await toBytes(input);
    var list = opts.comments || await comments(bytes, opts);
    var append = opts.mode !== 'separate';
    var doc = append ? await loadDoc(bytes) : await lib.PDFDocument.create();
    var originals = append ? doc.getPages() : [];
    var F = await fontsFor(doc);
    var W = 595.28, H = 841.89, M = 54, ink = rgb('#16131C'), muted = rgb('#5E5967');
    var page = doc.addPage([W, H]), g = geom(page), y = M + 20, summaryPages = 1;
    function newPage() { page = doc.addPage([W, H]); g = geom(page); y = M; summaryPages++; }
    drawText(g, 'Summary of comments', M, y, 20, F.bold, ink);
    y += 20;
    var authors = {};
    list.forEach(function (c) { if (c.author) authors[c.author] = 1; });
    var pagesWith = pageSet(list.map(function (c) { return { page: c.page }; }));
    drawText(g, plural(list.length, 'comment') + ' on ' + plural(pagesWith.length, 'page') + (Object.keys(authors).length ? ' · ' + plural(Object.keys(authors).length, 'person', 'people') : '') + ' · ' + trimTo(opts.name || '', 60) + ' · made ' + niceDate(), M, y, 9, F.sans, muted);
    y += 24;
    if (!list.length) drawText(g, 'This document has no comments, notes or highlights.', M, y, 11, F.sans, ink);
    var byId = {};
    list.forEach(function (c) { if (c.id) byId[c.id] = c; });
    var ordered = list.filter(function (c) { return !c.replyTo || !byId[c.replyTo]; });
    var replies = list.filter(function (c) { return c.replyTo && byId[c.replyTo]; });
    var lastPage = -1;
    function block(c, indent) {
      var head = 'Page ' + (c.page + 1) + ' · ' + c.type + (c.author ? ' · ' + c.author : '') + (c.date ? ' · ' + niceDate(new Date(c.date)) : '');
      var body = [];
      if (c.excerpt) wrapLines(F.sans, '“' + c.excerpt + '”', 9.5, W - 2 * M - indent - 10).slice(0, 6).forEach(function (l) { body.push([l, muted]); });
      if (c.text) wrapLines(F.sans, c.text, 10.5, W - 2 * M - indent - 10).slice(0, 30).forEach(function (l) { body.push([l, ink]); });
      var need = 16 + body.length * 14 + 10;
      if (y + need > H - M) newPage();
      if (c.page !== lastPage && !indent) { drawRule(g, M, y - 4, W - 2 * M, '#E3E0DA'); lastPage = c.page; }
      y += 10;
      drawText(g, head, M + indent, y, 9, F.bold, rgb('#5B3FD9'));
      if (append && originals[c.page]) addLink(doc, page, g.rect(M + indent, y - 10, widthOf(F.bold, head, 9) + 4, 14), originals[c.page]);
      y += 15;
      body.forEach(function (b) { drawText(g, b[0], M + indent + 10, y, b[1] === ink ? 10.5 : 9.5, F.sans, b[1]); y += 14; });
      y += 4;
    }
    ordered.forEach(function (c) {
      block(c, 0);
      replies.filter(function (r) { return r.replyTo === c.id; }).forEach(function (r) { block(r, 22); });
    });
    if (!append) { doc.setTitle('Summary of comments' + (opts.name ? ': ' + opts.name : '')); doc.setProducer('LocalEditor'); }
    return withReport(await doc.save(), { comments: list.length, summaryPages: summaryPages, pages: doc.getPageCount() });
  }

  /* =====================================================================
     D20 — fingerprint receipt
     ===================================================================== */

  function qrMatrix(text) {
    if (typeof global.qrcode !== 'function') throw new Error('The QR code library is not loaded');
    var q = global.qrcode(0, 'M');
    q.addData(text, 'Byte');
    q.make();
    var n = q.getModuleCount(), m = [];
    for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
    return m;
  }
  function loadQr() {
    if (typeof global.qrcode === 'function') return Promise.resolve();
    var root = '';
    try { root = d.documentElement.getAttribute('data-root') || ''; } catch (e) {}
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return LE.lazy(root + 'assets/vendor/qrcode.js').then(function () {
      if (typeof global.qrcode !== 'function') throw new Error('The QR code library failed to start');
    });
  }
  function drawQr(g, matrix, vx, vy, size) {
    var n = matrix.length, cell = size / (n + 8), ox = vx + cell * 4, oy = vy + cell * 4;
    drawBox(g, vx, vy, size, size, { fill: '#FFFFFF' });
    for (var r = 0; r < n; r++) {
      var c = 0;
      while (c < n) {
        if (!matrix[r][c]) { c++; continue; }
        var s = c;
        while (c < n && matrix[r][c]) c++;
        drawBox(g, ox + s * cell, oy + r * cell, (c - s) * cell + 0.02, cell + 0.02, { fill: '#000000' });
      }
    }
  }
  /* fingerprint(input, { name }) → { sha256, short, bytes, pages, name, url, at } */
  async function fingerprint(input, opts) {
    opts = opts || {};
    var bytes = await toBytes(input);
    var hex = await sha256(bytes);
    var pages = null;
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && global.pdfjsLib) {
      try { var pdf = await pdfjsOpen(bytes, opts.password); pages = pdf.numPages; pdf.destroy(); } catch (e) { pages = null; }
    }
    var at = opts.at ? new Date(opts.at) : new Date();
    return { sha256: hex, short: shortHash(hex), bytes: bytes.length, pages: pages, name: opts.name || (input && input.name) || 'document.pdf', url: verifyUrl(hex, opts), at: at.toISOString() };
  }
  var PROVES = 'If a copy gives the same fingerprint, it is byte for byte the same file as when this receipt was made.';
  var NOT_PROVES = 'A fingerprint does not show who made the file or when it was first created. Any change, even re-saving it, gives a different fingerprint.';
  /* A one-page receipt PDF. → Uint8Array with .report (the fingerprint object). */
  async function receiptPdf(input, opts) {
    opts = opts || {};
    await ready();
    await loadQr();
    var fp = opts.fingerprint || await fingerprint(input, opts);
    var lib = PL();
    var out = await lib.PDFDocument.create();
    await addReceiptPage(out, fp, opts);
    out.setTitle('Fingerprint receipt: ' + fp.name);
    out.setProducer('LocalEditor');
    out.setCreator('LocalEditor');
    return withReport(await out.save(), fp);
  }
  async function addReceiptPage(out, fp, opts) {
    var F = await fontsFor(out);
    var W = 595.28, H = 841.89, M = 56, ink = rgb('#16131C'), muted = rgb('#5E5967');
    var page = out.addPage([W, H]), g = geom(page), y = M + 18;
    drawText(g, 'Fingerprint receipt', M, y, 22, F.bold, ink);
    y += 18;
    drawText(g, 'A record of exactly which file this is. Made with LocalEditor on this device.', M, y, 9.5, F.sans, muted);
    y += 30;
    var at = new Date(fp.at);
    var rows = [['File', fp.name], ['Size', fmtBytes(fp.bytes) + ' (' + fp.bytes.toLocaleString('en-US') + ' bytes)'], ['Pages', fp.pages == null ? 'Not a PDF, or it could not be read' : String(fp.pages)], ['Receipt made', niceDate(at) + ' at ' + niceTime(at) + ' (' + fp.at.replace(/\.\d+Z$/, 'Z') + ')']];
    rows.forEach(function (r) {
      drawText(g, r[0].toUpperCase(), M, y, 7.5, F.bold, muted);
      y += 13;
      wrapLines(F.sans, r[1], 11.5, W - 2 * M).slice(0, 3).forEach(function (ln) { drawText(g, ln, M, y, 11.5, F.sans, ink); y += 15; });
      y += 8;
    });
    y += 6;
    drawText(g, 'FINGERPRINT (SHA-256)', M, y, 7.5, F.bold, muted);
    y += 26;
    drawText(g, fp.short, M, y, 24, F.bold, ink);
    y += 22;
    var full = fp.sha256.replace(/(.{8})/g, '$1 ').trim();
    drawText(g, full.slice(0, 35), M, y, 10, F.mono, ink); y += 14;
    drawText(g, full.slice(36), M, y, 10, F.mono, ink); y += 28;
    var qr = qrMatrix(fp.url);
    var qs = 150;
    drawQr(g, qr, M - 10, y, qs);
    var tx = M + qs + 6, ty = y + 34;
    drawText(g, 'Check a copy', tx, ty, 13, F.bold, ink); ty += 18;
    wrapLines(F.sans, 'Scan this code, or open localeditor.net/verify, and drop the copy in. It is checked on that device; the file is not uploaded.', 10, W - tx - M).forEach(function (ln) { drawText(g, ln, tx, ty, 10, F.sans, muted); ty += 13.5; });
    var link = fp.url;
    y += qs + 14;
    drawBox(g, M, y, W - 2 * M, 92, { fill: '#F3F1ED' });
    var yy = y + 20;
    drawText(g, 'What this shows', M + 14, yy, 10, F.bold, ink); yy += 15;
    wrapLines(F.sans, PROVES, 9.5, W - 2 * M - 28).forEach(function (ln) { drawText(g, ln, M + 14, yy, 9.5, F.sans, ink); yy += 13; });
    yy += 3;
    wrapLines(F.sans, NOT_PROVES, 9.5, W - 2 * M - 28).forEach(function (ln) { drawText(g, ln, M + 14, yy, 9.5, F.sans, muted); yy += 13; });
    drawText(g, trimTo(link, 100), M, H - 40, 7, F.mono, muted);
    return page;
  }
  /* A small card picture (PNG Blob) with the same details, for chat or email. */
  async function receiptCard(input, opts) {
    opts = opts || {};
    await loadQr();
    var fp = opts.fingerprint || await fingerprint(input, opts);
    var W = 1200, H = 630, c = d.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var font = '"Plus Jakarta Sans", system-ui, sans-serif';
    g.fillStyle = '#F7F6F3'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFFFFF'; g.fillRect(40, 40, W - 80, H - 80);
    g.strokeStyle = '#E3E0DA'; g.lineWidth = 2; g.strokeRect(40, 40, W - 80, H - 80);
    g.fillStyle = '#E2B15A'; g.fillRect(80, 92, 70, 6);
    g.fillStyle = '#16131C'; g.font = '750 46px ' + font; g.fillText('Fingerprint receipt', 80, 160);
    g.fillStyle = '#5E5967'; g.font = '500 24px ' + font;
    var name = trimTo(fp.name, 44);
    g.fillText(name, 80, 210);
    g.fillText(fmtBytes(fp.bytes) + (fp.pages != null ? ' · ' + plural(fp.pages, 'page') : '') + ' · ' + niceDate(new Date(fp.at)), 80, 248);
    g.fillStyle = '#16131C'; g.font = '800 60px ' + font; g.fillText(fp.short, 80, 360);
    g.fillStyle = '#5E5967'; g.font = '500 19px ui-monospace, monospace';
    g.fillText(fp.sha256.slice(0, 32), 80, 405); g.fillText(fp.sha256.slice(32), 80, 432);
    g.font = '500 20px ' + font;
    g.fillText('Same fingerprint = the very same file. It does not show who made it.', 80, 520);
    var qr = qrMatrix(fp.url), n = qr.length, size = 300, cell = Math.floor(size / (n + 8));
    var qx = W - 80 - cell * (n + 8), qy = (H - cell * (n + 8)) / 2;
    g.fillStyle = '#FFFFFF'; g.fillRect(qx, qy, cell * (n + 8), cell * (n + 8));
    g.fillStyle = '#000000';
    for (var r = 0; r < n; r++) for (var cc = 0; cc < n; cc++) if (qr[r][cc]) g.fillRect(qx + (cc + 4) * cell, qy + (r + 4) * cell, cell, cell);
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/png'); });
    blob.fingerprint = fp;
    return blob;
  }
  /* A copy with the receipt added as the last page. The fingerprint on that page is of the ORIGINAL file; the new copy has
     its own, different fingerprint. → Uint8Array with .report { original, receipt: fingerprint of the new copy } */
  async function appendReceipt(input, opts) {
    opts = opts || {};
    await ready();
    await loadQr();
    var bytes = await toBytes(input);
    var fp = opts.fingerprint || await fingerprint(bytes, opts);
    var doc = await loadDoc(bytes);
    await addReceiptPage(doc, fp, opts);
    var out = await doc.save();
    return withReport(out, { original: fp, copy: await sha256(out) });
  }
  /* A copy with the original's fingerprint written into the file's details (Subject and Keywords). Same caveat as above. */
  async function embedFingerprint(input, opts) {
    opts = opts || {};
    await ready();
    var bytes = await toBytes(input);
    var fp = opts.fingerprint || await fingerprint(bytes, opts);
    var doc = await loadDoc(bytes);
    doc.setSubject('SHA-256 of the original file: ' + fp.sha256);
    doc.setKeywords(['sha256:' + fp.sha256]);
    var out = await doc.save();
    return withReport(out, { original: fp, copy: await sha256(out) });
  }

  /* =====================================================================
     D19 — saved PDF workflows (.lepdfworkflow)
     ===================================================================== */

  var WF_FORMAT = 'localeditor-pdf-workflow';
  var WF_MAX_CHARS = 200000, WF_MAX_STEPS = 30, WF_MAX_DEPTH = 8;
  var FORBIDDEN = /^(password|passwords|userpassword|ownerpassword|currentpassword|pass|pwd|passcode|secret|key|token|pin)$/i;
  var MARKUP = /<\s*(script|iframe|svg|img|a\s|style|object|embed|link|meta)|javascript:|vbscript:|data:text\/html|\bon[a-z]+\s*=/i;
  var RANGE_RE = /^(all|odd|even|first|last|(\d+(-\d*)?|-\d+)(\s*,\s*(\d+(-\d*)?|-\d+))*)$/;
  /* Parameter types: ['num', min, max, default] ['int', …] ['enum', [values], default] ['bool', default] ['text', maxLength, default]
     ['color', default] ['range', default] ['obj', { … }] */
  var P = {
    position: ['enum', POSITIONS, 'bc'],
    pages: ['range', 'all']
  };
  var OPS = {
    'merge': { label: 'Combine files', about: 'Joins every file in the run into one, in the order given.', combines: true,
      params: { order: ['enum', ['as-given', 'name'], 'as-given'] } },
    'bundle': { label: 'Make a pack', about: 'Joins the files with a cover page, contents and bookmarks.', combines: true,
      params: { title: ['text', 120, ''], subtitle: ['text', 160, ''], preparedBy: ['text', 80, ''], preparedFor: ['text', 80, ''], date: ['text', 40, 'today'], cover: ['bool', true], contents: ['bool', true], bookmarks: ['bool', true], paper: ['enum', ['a4', 'letter', 'legal'], 'a4'] } },
    'rotate': { label: 'Rotate pages', params: { degrees: ['enum', [90, 180, 270], 90], pages: P.pages } },
    'delete-pages': { label: 'Remove pages', params: { pages: ['range', ''] }, required: ['pages'] },
    'keep-pages': { label: 'Keep only some pages', params: { pages: ['range', ''] }, required: ['pages'] },
    'reverse': { label: 'Reverse page order', params: {} },
    'page-numbers': { label: 'Number the pages', params: { position: P.position, format: ['enum', Object.keys(NUM_FORMATS), 'page-n-of-N'], start: ['int', 0, 100000, 1], skipFirst: ['bool', false], size: ['num', 6, 24, 9.5] } },
    'header-footer': { label: 'Header and footer', params: { headerLeft: ['text', 120, ''], headerCenter: ['text', 120, ''], headerRight: ['text', 120, ''], footerLeft: ['text', 120, ''], footerCenter: ['text', 120, ''], footerRight: ['text', 120, ''], skipFirst: ['bool', false] } },
    'bates': { label: 'Bates numbers', params: { prefix: ['text', 24, 'DOC-'], start: ['int', 0, 99999999, 1], digits: ['int', 1, 12, 6], position: ['enum', POSITIONS, 'br'] } },
    'watermark': { label: 'Watermark', params: { text: ['text', 80, 'CONFIDENTIAL'], style: ['enum', ['diagonal', 'tiled', 'footer'], 'diagonal'], opacity: ['num', 0.03, 1, 0.15], color: ['color', '#C62828'], size: ['num', 0, 200, 0] }, required: ['text'] },
    'stamp': { label: 'Stamp', params: { preset: ['enum', STAMP_PRESETS.map(function (p) { return p.id; }).concat(['custom']), 'approved'], text: ['text', 40, ''], color: ['color', ''], shape: ['enum', ['rounded', 'box', 'oval', 'plain'], 'rounded'], name: ['text', 60, ''], date: ['bool', true], time: ['bool', false], pages: ['enum', ['all', 'first', 'last'], 'first'], position: ['enum', ['tl', 'tc', 'tr', 'cc', 'bl', 'bc', 'br'], 'tr'], size: ['num', 8, 72, 20] } },
    'metadata': { label: 'Title and author', params: { title: ['text', 200, ''], author: ['text', 120, ''], subject: ['text', 200, ''] } },
    'comment-summary': { label: 'Add a summary of comments', params: {} },
    'compress': { label: 'Make smaller', params: { preset: ['enum', ['email', '2mb', '500kb', 'lossless'], 'email'], allowPictures: ['bool', false] } },
    'scrub': { label: 'Remove hidden details', params: { metadata: ['bool', true], attachments: ['bool', true], comments: ['enum', ['keep', 'flatten', 'remove'], 'keep'], forms: ['enum', ['keep', 'flatten', 'remove'], 'keep'], links: ['bool', false], hiddenText: ['bool', true] } },
    'make-safe': { label: 'Remove scripts and actions', params: { keepAttachments: ['bool', false] } },
    'safe-to-send': { label: 'Safe to send', params: { flatten: ['bool', true], removeLinks: ['bool', false], compress: ['bool', true] } },
    'protect': { label: 'Password-protect', about: 'Asks for a password each time the workflow runs. Workflows never store passwords.',
      params: { ask: ['enum', [true], true], printing: ['enum', ['high', 'low', 'none'], 'high'], copying: ['bool', true], modifying: ['bool', false] } }
  };
  function hasBadKey(v, depth) {
    if (depth > WF_MAX_DEPTH) return true;
    if (Array.isArray(v)) return v.some(function (x) { return hasBadKey(x, depth + 1); });
    if (v && typeof v === 'object') return Object.keys(v).some(function (k) { return !safeKey(k) || hasBadKey(v[k], depth + 1); });
    return false;
  }
  function depthOf(v, dd) {
    if (dd > 40) return dd;
    if (Array.isArray(v)) return v.reduce(function (m, x) { return Math.max(m, depthOf(x, dd + 1)); }, dd + 1);
    if (v && typeof v === 'object') return Object.keys(v).reduce(function (m, k) { return Math.max(m, depthOf(v[k], dd + 1)); }, dd + 1);
    return dd;
  }
  function findKey(v, re, path) {
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var r = findKey(v[i], re, path + '[' + i + ']'); if (r) return r; } return null; }
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      for (var k = 0; k < keys.length; k++) {
        if (re.test(keys[k])) return path ? path + '.' + keys[k] : keys[k];
        var r2 = findKey(v[keys[k]], re, path ? path + '.' + keys[k] : keys[k]);
        if (r2) return r2;
      }
    }
    return null;
  }
  function findString(v, test) {
    if (typeof v === 'string') return test(v) ? v : null;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var r = findString(v[i], test); if (r) return r; } return null; }
    if (v && typeof v === 'object') { var keys = Object.keys(v); for (var k = 0; k < keys.length; k++) { var r2 = findString(keys[k], test) || findString(v[keys[k]], test); if (r2) return r2; } }
    return null;
  }
  function checkParam(spec, value, where) {
    var t = spec[0];
    if (t === 'num' || t === 'int') {
      if (typeof value !== 'number' || !isFinite(value)) throw new Error(where + ' must be a number.');
      if (t === 'int' && Math.floor(value) !== value) throw new Error(where + ' must be a whole number.');
      if (value < spec[1] || value > spec[2]) throw new Error(where + ' must be between ' + spec[1] + ' and ' + spec[2] + '.');
      return value;
    }
    if (t === 'enum') { if (spec[1].indexOf(value) < 0) throw new Error(where + ' must be one of: ' + spec[1].join(', ') + '.'); return value; }
    if (t === 'bool') { if (typeof value !== 'boolean') throw new Error(where + ' must be true or false.'); return value; }
    if (t === 'text') { if (typeof value !== 'string') throw new Error(where + ' must be text.'); if (value.length > spec[1]) throw new Error(where + ' is longer than ' + spec[1] + ' characters.'); return value.replace(/[<>\u0000-\u0008\u000b-\u001f]/g, ''); }
    if (t === 'color') { if (typeof value !== 'string' || (value !== '' && !/^#[0-9a-fA-F]{6}$/.test(value))) throw new Error(where + ' must be a colour like #C62828.'); return value; }
    if (t === 'range') { if (typeof value !== 'string' || value.length > 200 || (value !== '' && !RANGE_RE.test(value.replace(/\s+/g, '').replace(/,/g, ', ').trim().replace(/\s/g, '')))) throw new Error(where + ' must be pages like "all", "odd", "1-3, 7" or "last".'); return value.replace(/\s+/g, ''); }
    throw new Error(where + ' has an unknown type.');
  }
  function slug(s, max) { return fold(str(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 60); }
  /* validateWorkflow(textOrObject) → { ok, errors, warnings, workflow } — the workflow is normalised (fields in a fixed order,
     defaults filled, unknown parameters dropped with a warning). Nothing in a workflow is ever evaluated. */
  function validateWorkflow(input) {
    var errors = [], warnings = [];
    function fail(msg) { errors.push(msg); return { ok: false, errors: errors, warnings: warnings, workflow: null }; }
    var data = input;
    if (typeof input === 'string') {
      if (input.length > WF_MAX_CHARS) return fail('The file is larger than ' + WF_MAX_CHARS.toLocaleString('en-US') + ' characters.');
      try { data = JSON.parse(input); } catch (e) { return fail('This is not a workflow file (it is not valid JSON).'); }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('This is not a workflow file.');
    if (depthOf(data, 0) > WF_MAX_DEPTH) return fail('The file is nested too deeply.');
    if (hasBadKey(data, 0)) return fail('The file uses a forbidden key (__proto__, constructor or prototype).');
    var pwKey = findKey(data, FORBIDDEN, '');
    if (pwKey) return fail('Workflows never store passwords or keys, so “' + pwKey + '” is not allowed. A protect step asks for the password when it runs.');
    var bad = findString(data, function (s) { return MARKUP.test(s); });
    if (bad) return fail('The file contains markup or script, which workflows never allow.');
    if (data.format !== WF_FORMAT) return fail('This is not a LocalEditor PDF workflow (format must be "' + WF_FORMAT + '").');
    var ver = typeof data.version === 'number' ? String(data.version) : str(data.version);
    if (!/^\d+(\.\d+)?$/.test(ver)) return fail('The version is missing.');
    if (+ver.split('.')[0] > 1) return fail('This workflow needs a newer LocalEditor (version ' + ver + ').');
    if (!Array.isArray(data.steps) || !data.steps.length) return fail('The workflow has no steps.');
    if (data.steps.length > WF_MAX_STEPS) return fail('A workflow can have up to ' + WF_MAX_STEPS + ' steps.');
    var meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    var out = {
      format: WF_FORMAT, version: '1.0',
      metadata: {
        id: slug(meta.id || meta.name || 'workflow') || 'workflow',
        name: cleanText(meta.name, 80) || 'Untitled workflow',
        description: cleanText(meta.description, 400),
        author: cleanText(meta.author, 80),
        tags: (Array.isArray(meta.tags) ? meta.tags : []).slice(0, 8).map(function (t) { return slug(t, 24); }).filter(Boolean),
        created: /^\d{4}-\d{2}-\d{2}$/.test(str(meta.created)) ? meta.created : isoDate()
      },
      steps: []
    };
    Object.keys(meta).forEach(function (k) { if (['id', 'name', 'description', 'author', 'tags', 'created'].indexOf(k) < 0) warnings.push('metadata.' + k + ' is not used and was dropped.'); });
    Object.keys(data).forEach(function (k) { if (['format', 'version', 'metadata', 'steps'].indexOf(k) < 0) warnings.push('“' + k + '” is not used and was dropped.'); });
    var ids = {}, combined = false;
    for (var i = 0; i < data.steps.length; i++) {
      var s = data.steps[i];
      var where = 'Step ' + (i + 1);
      if (!s || typeof s !== 'object' || Array.isArray(s)) return fail(where + ' is not a step.');
      var op = OPS[s.operation];
      if (!op || !own(OPS, s.operation)) return fail(where + ': “' + str(s.operation).slice(0, 40) + '” is not a LocalEditor PDF operation.');
      var params = s.parameters == null ? {} : s.parameters;
      if (typeof params !== 'object' || Array.isArray(params)) return fail(where + ': parameters must be an object.');
      var clean = {};
      try {
        Object.keys(op.params).forEach(function (k) {
          var spec = op.params[k];
          if (own(params, k)) clean[k] = checkParam(spec, params[k], where + ' (' + s.operation + ') ' + k);
          else clean[k] = spec[0] === 'enum' ? spec[2] : spec[spec.length - 1];
        });
      } catch (e) { return fail(e.message); }
      (op.required || []).forEach(function (k) { if (clean[k] === '' || clean[k] == null) errors.push(where + ' (' + s.operation + ') needs ' + k + '.'); });
      if (errors.length) return fail(errors.pop());
      Object.keys(params).forEach(function (k) { if (!own(op.params, k)) warnings.push(where + ': parameter “' + k + '” is not used by ' + s.operation + ' and was dropped.'); });
      if (s.operation === 'stamp' && clean.preset === 'custom' && !clean.text) return fail(where + ' (stamp): a custom stamp needs text.');
      if (op.combines) { if (combined) return fail(where + ': only one step can combine files (merge or bundle).'); combined = true; }
      var id = /^[A-Za-z0-9_-]{1,40}$/.test(str(s.id)) && !ids[s.id] ? s.id : s.operation + '-' + (i + 1);
      while (ids[id]) id += '-x';
      ids[id] = 1;
      var step = { id: id, operation: s.operation, label: cleanText(s.label, 60) || op.label, enabled: s.enabled !== false, parameters: clean };
      if (s.enabled != null && typeof s.enabled !== 'boolean') return fail(where + ': enabled must be true or false.');
      Object.keys(s).forEach(function (k) { if (['id', 'operation', 'label', 'enabled', 'parameters'].indexOf(k) < 0) warnings.push(where + ': “' + k + '” is not used and was dropped.'); });
      out.steps.push(step);
    }
    return { ok: true, errors: [], warnings: warnings, workflow: out };
  }
  function serializeWorkflow(wf) {
    var v = validateWorkflow(wf);
    if (!v.ok) throw new Error(v.errors[0]);
    return JSON.stringify(v.workflow, null, 2) + '\n';
  }
  function wf(id, name, description, steps, tags) {
    return validateWorkflow({ format: WF_FORMAT, version: '1.0', metadata: { id: id, name: name, description: description, author: 'LocalEditor', tags: tags || [], created: '2026-11-12' }, steps: steps }).workflow;
  }
  var BUILTINS = [
    wf('safe-to-send', 'Safe to send', 'Flattens forms and comments, removes hidden details and active content, and makes the file smaller. For anything leaving the office.', [
      { operation: 'safe-to-send', parameters: { flatten: true, removeLinks: false, compress: true } }
    ], ['privacy', 'send']),
    wf('email-friendly', 'Email-friendly', 'Removes author and software details, then makes the file small enough for email without turning text into pictures.', [
      { operation: 'scrub', parameters: { metadata: true, attachments: false, comments: 'keep', forms: 'keep', links: false, hiddenText: false } },
      { operation: 'compress', parameters: { preset: 'email', allowPictures: false } }
    ], ['email', 'size']),
    wf('numbered-draft', 'Numbered and watermarked draft', 'Page X of Y at the bottom, a DRAFT stamp with today’s date on the first page and a light DRAFT watermark on every page.', [
      { operation: 'page-numbers', parameters: { position: 'bc', format: 'page-n-of-N' } },
      { operation: 'stamp', parameters: { preset: 'draft', date: true, pages: 'first', position: 'tr' } },
      { operation: 'watermark', parameters: { text: 'DRAFT', style: 'diagonal', opacity: 0.08, color: '#5E5967' } }
    ], ['draft', 'review']),
    wf('client-pack', 'Client pack', 'Combines the files into one pack with a cover, contents and bookmarks, numbers the pages, removes hidden details and asks for a password.', [
      { operation: 'bundle', parameters: { title: 'Client pack', cover: true, contents: true, bookmarks: true } },
      { operation: 'page-numbers', parameters: { position: 'bc', format: 'page-n-of-N', skipFirst: true } },
      { operation: 'scrub', parameters: { metadata: true, attachments: true, comments: 'flatten', forms: 'flatten', links: false, hiddenText: true } },
      { operation: 'protect', parameters: { ask: true, printing: 'high', copying: true, modifying: false } }
    ], ['pack', 'client'])
  ];
  function needsPassword(workflow) { return !!(workflow && workflow.steps.some(function (s) { return s.enabled && s.operation === 'protect'; })); }
  function pagesFor(spec, count) {
    spec = str(spec || 'all');
    var all = []; for (var i = 0; i < count; i++) all.push(i);
    if (spec === 'all' || spec === '') return all;
    if (spec === 'odd') return all.filter(function (i) { return i % 2 === 0; });
    if (spec === 'even') return all.filter(function (i) { return i % 2 === 1; });
    if (spec === 'first') return [0];
    if (spec === 'last') return [count - 1];
    return LE.pdf.parseRanges(spec, count).pages.map(function (n) { return n - 1; });
  }
  function securityResult(b, what) {
    var r = b && b.report;
    if (!b || !b.length) throw new Error(what + ' failed: ' + ((r && r.error) || 'the file could not be processed'));
    return u8(b);
  }
  async function runStep(step, files, ctx) {
    var p = step.parameters, op = step.operation, lib = PL();
    if (op === 'merge' || op === 'bundle') {
      var list = files.slice();
      if (op === 'merge' && p.order === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
      if (op === 'merge') {
        var out = await lib.PDFDocument.create();
        for (var i = 0; i < list.length; i++) { var src = await loadDoc(list[i].bytes); (await out.copyPages(src, src.getPageIndices())).forEach(function (pg) { out.addPage(pg); }); }
        out.setProducer('LocalEditor');
        return [{ name: (ctx.outName || baseName(list[0].name) + '-combined') + '.pdf', bytes: u8(await out.save()), detail: plural(list.length, 'file') + ' → ' + plural(out.getPageCount(), 'page') }];
      }
      var b = await bundle({
        items: list.map(function (f) { return { kind: 'pdf', name: f.name, bytes: f.bytes }; }),
        cover: p.cover ? { title: p.title || 'Document pack', subtitle: p.subtitle, preparedBy: p.preparedBy, preparedFor: p.preparedFor, date: p.date || 'today' } : null,
        toc: p.contents ? { title: 'Contents' } : false, bookmarks: p.bookmarks, paper: p.paper, title: p.title
      }, ctx);
      return [{ name: (slug(p.title, 60) || 'pack') + '.pdf', bytes: u8(b), detail: plural(list.length, 'file') + ' → ' + plural(b.report.pages, 'page') }];
    }
    var outFiles = [];
    for (var f = 0; f < files.length; f++) {
      checkCancel(ctx);
      var file = files[f], bytes = file.bytes, res, detail = '';
      if (op === 'rotate' || op === 'delete-pages' || op === 'keep-pages' || op === 'reverse' || op === 'page-numbers' || op === 'header-footer' || op === 'bates' || op === 'metadata') {
        var doc = await loadDoc(bytes);
        var n = doc.getPageCount();
        if (op === 'rotate') { var sel = pagesFor(p.pages, n); sel.forEach(function (i) { var pg = doc.getPage(i); pg.setRotation(lib.degrees(((pg.getRotation().angle || 0) + p.degrees) % 360)); }); detail = plural(sel.length, 'page') + ' turned ' + p.degrees + '°'; }
        else if (op === 'delete-pages' || op === 'keep-pages') {
          var hit = pagesFor(p.pages, n), keep = {};
          hit.forEach(function (i) { keep[i] = 1; });
          var remove = [];
          for (var q = n - 1; q >= 0; q--) if (op === 'delete-pages' ? keep[q] : !keep[q]) remove.push(q);
          if (remove.length >= n) throw new Error(step.label + ' would leave “' + file.name + '” with no pages.');
          remove.forEach(function (i) { doc.removePage(i); });
          detail = plural(remove.length, 'page') + ' removed';
        } else if (op === 'reverse') {
          var rev = await lib.PDFDocument.create();
          var idx = doc.getPageIndices().reverse();
          (await rev.copyPages(doc, idx)).forEach(function (pg) { rev.addPage(pg); });
          doc = rev;
          detail = plural(n, 'page') + ' reversed';
        } else if (op === 'page-numbers') {
          await stampChrome(doc, { numbers: { position: p.position, format: p.format, start: p.start, size: p.size }, skip: p.skipFirst ? 1 : 0 });
          detail = 'numbered from ' + p.start;
        } else if (op === 'header-footer') {
          await stampChrome(doc, { header: { left: p.headerLeft, center: p.headerCenter, right: p.headerRight }, footer: { left: p.footerLeft, center: p.footerCenter, right: p.footerRight }, skip: p.skipFirst ? 1 : 0, title: doc.getTitle() || baseName(file.name), files: doc.getPages().map(function () { return file.name; }) });
        } else if (op === 'bates') {
          var startB = (ctx.batesNext != null ? ctx.batesNext : p.start);
          await stampChrome(doc, { bates: { prefix: p.prefix, start: startB, digits: p.digits, position: p.position } });
          ctx.batesNext = startB + n;
          detail = 'numbers ' + startB + '–' + (startB + n - 1);
        } else if (op === 'metadata') {
          if (p.title) doc.setTitle(p.title);
          if (p.author) doc.setAuthor(p.author);
          if (p.subject) doc.setSubject(p.subject);
        }
        res = u8(await doc.save());
      } else if (op === 'watermark') {
        if (!LE.pdfBulk || !LE.pdfBulk.watermark) throw new Error('Watermarks need the bulk tools, which are not loaded on this page.');
        res = u8(await LE.pdfBulk.watermark(bytes, p.text, { style: p.style, opacity: p.opacity, color: p.color, size: p.size || undefined }));
      } else if (op === 'stamp') {
        res = await stampPages(bytes, { preset: p.preset === 'custom' ? null : p.preset, text: p.text, color: p.color || undefined, shape: p.shape, name: p.name, date: p.date, time: p.time, when: ctx.now }, { pages: p.pages, position: p.position, size: p.size });
      } else if (op === 'comment-summary') {
        res = await commentSummary(bytes, { mode: 'append', name: file.name });
        detail = plural(res.report.comments, 'comment');
      } else if (op === 'compress') {
        if (!LE.pdfBulk || !LE.pdfBulk.compress) throw new Error('Making files smaller needs the bulk tools, which are not loaded on this page.');
        var preset = LE.pdfBulk.presets && LE.pdfBulk.presets[p.preset];
        var cr = await LE.pdfBulk.compress(bytes, { preset: p.preset, targetBytes: preset ? preset.targetBytes : 0, allowRaster: !!p.allowPictures, onProgress: null });
        res = u8(cr.bytes);
        detail = fmtBytes(bytes.length) + ' → ' + fmtBytes(res.length) + (cr.report && cr.report.rasterized ? ' (pages turned into pictures)' : '');
      } else if (op === 'scrub' || op === 'make-safe' || op === 'safe-to-send') {
        if (!LE.pdfSecurity) throw new Error('This step needs the protect tools, which are not loaded on this page.');
        if (op === 'scrub') res = securityResult(await LE.pdfSecurity.scrub(bytes, Object.assign(LE.pdfSecurity.scrubDefaults ? LE.pdfSecurity.scrubDefaults() : {}, { metadata: p.metadata, documentId: p.metadata, attachments: p.attachments, comments: p.comments, forms: p.forms, links: p.links, hiddenText: p.hiddenText, reinspect: false })), 'Removing hidden details');
        else if (op === 'make-safe') res = securityResult(await LE.pdfSecurity.makeSafe(bytes, { keepAttachments: p.keepAttachments }), 'Removing scripts and actions');
        else res = securityResult(await LE.pdfSecurity.safeToSend(bytes, { flatten: p.flatten, removeLinks: p.removeLinks, compress: p.compress }), 'Safe to send');
      } else if (op === 'protect') {
        if (!LE.pdfBulk || !LE.pdfBulk.protect) throw new Error('Passwords need the bulk tools, which are not loaded on this page.');
        var pw = ctx.password;
        if (!pw) throw new Error('A password is needed for the protect step.');
        res = u8(await LE.pdfBulk.protect(bytes, { userPassword: pw, permissions: { printing: p.printing === 'none' ? false : p.printing, copying: p.copying, modifying: p.modifying, annotating: p.modifying, assembly: p.modifying } }));
        detail = 'locked with AES-256';
      } else throw new Error('Unknown operation ' + op);
      outFiles.push({ name: file.name, bytes: res, detail: detail });
      await tick();
    }
    return outFiles;
  }
  /* runWorkflow(files, workflow, opts) → { files: [{ name, bytes }], log: [{ step, label, ok, detail }] }
     files: [{ name, bytes | Blob }]. opts: { password (only used by a protect step; never stored), askPassword: async () => string,
     onProgress, signal, outName }. Steps run in order; a merge or bundle step combines every file into one. */
  async function runWorkflow(files, workflow, opts) {
    opts = opts || {};
    await ready();
    var v = validateWorkflow(workflow);
    if (!v.ok) throw new Error(v.errors[0]);
    var w = v.workflow;
    var list = [];
    for (var i = 0; i < (files || []).length; i++) list.push({ name: /\.pdf$/i.test(files[i].name || '') ? files[i].name : (files[i].name || 'document') + '.pdf', bytes: u8(await toBytes(files[i].bytes || files[i])) });
    if (!list.length) throw new Error('Choose at least one PDF to run the workflow on.');
    var ctx = { now: opts.now || new Date(), signal: opts.signal, isCancelled: opts.isCancelled, outName: opts.outName };
    var steps = w.steps.filter(function (s) { return s.enabled; });
    if (steps.some(function (s) { return s.operation === 'protect'; })) {
      ctx.password = opts.password || (opts.askPassword ? await opts.askPassword() : null);
      if (!ctx.password) throw new Error('This workflow asks for a password, and none was given.');
    }
    var log = [];
    try {
      for (var s = 0; s < steps.length; s++) {
        checkCancel(ctx);
        progress(opts, s, steps.length, steps[s].label);
        try {
          var outFiles = await runStep(steps[s], list, ctx);
          var detail = outFiles.map(function (f) { return f.detail; }).filter(Boolean);
          log.push({ step: steps[s].id, operation: steps[s].operation, label: steps[s].label, ok: true, detail: detail.length === 1 ? detail[0] : detail.length ? detail[0] + (detail.length > 1 ? ' (and ' + (detail.length - 1) + ' more)' : '') : '' });
          list = outFiles.map(function (f) { return { name: f.name, bytes: f.bytes }; });
        } catch (e) {
          if (e && e.cancelled) throw e;
          log.push({ step: steps[s].id, operation: steps[s].operation, label: steps[s].label, ok: false, detail: e && e.message ? e.message : String(e) });
          var err = new Error(steps[s].label + ': ' + (e && e.message ? e.message : e));
          err.log = log;
          throw err;
        }
      }
    } finally { ctx.password = null; }
    progress(opts, steps.length, steps.length, 'Done');
    return { files: list, log: log, workflow: w };
  }
  var WF_STORE = 'le-pdf-workflows';
  var workflows = {
    builtins: function () { return BUILTINS.map(function (x) { return JSON.parse(JSON.stringify(x)); }); },
    operations: function () { return Object.keys(OPS).map(function (k) { return { id: k, label: OPS[k].label, about: OPS[k].about || '', combines: !!OPS[k].combines, params: JSON.parse(JSON.stringify(OPS[k].params)) }; }); },
    saved: function () { var all = lsGet(WF_STORE, []); return (Array.isArray(all) ? all : []).map(function (x) { var v = validateWorkflow(x); return v.ok ? v.workflow : null; }).filter(Boolean); },
    save: function (w) {
      var v = validateWorkflow(w);
      if (!v.ok) throw new Error(v.errors[0]);
      var list = workflows.saved().filter(function (x) { return x.metadata.id !== v.workflow.metadata.id; });
      list.unshift(v.workflow);
      if (!lsSet(WF_STORE, list.slice(0, 40))) throw new Error('This browser would not save the workflow.');
      return v.workflow;
    },
    remove: function (id) { lsSet(WF_STORE, workflows.saved().filter(function (x) { return x.metadata.id !== id; })); return true; },
    validate: validateWorkflow,
    serialize: serializeWorkflow,
    run: runWorkflow,
    needsPassword: needsPassword,
    extension: '.lepdfworkflow',
    mime: 'application/vnd.localeditor.pdf-workflow+json'
  };

  LE.pdfOffice = {
    version: VERSION,
    /* D20 */
    sha256: sha256, shortHash: shortHash, verifyUrl: verifyUrl, hashFromUrl: hashFromUrl,
    fingerprint: fingerprint, receiptPdf: receiptPdf, receiptCard: receiptCard, appendReceipt: appendReceipt, embedFingerprint: embedFingerprint, qrMatrix: qrMatrix, loadQr: loadQr,
    proves: PROVES, doesNotProve: NOT_PROVES,
    /* D11 */
    details: details, formFields: formFields, formFingerprint: formFingerprint, mappings: mappings, propose: propose, fill: fillFields, classifyField: classify,
    /* D14 */
    diff: myers, diffTokens: diffTokens, compare: compare, compareReport: compareReport, visualDiff: visualDiff, renderPage: renderPage, alignPages: alignPages,
    /* D15 */
    bundle: bundle, bundlePlan: bundlePlan, stampChrome: stampChrome, numberFormats: Object.keys(NUM_FORMATS),
    /* D16 */
    stampPresets: STAMP_PRESETS, stampSpec: stampSpec, stampCanvas: stampCanvas, stampPages: stampPages, comments: comments, commentsCsv: commentsCsv, commentSummary: commentSummary,
    /* D19 */
    workflows: workflows, validateWorkflow: validateWorkflow, runWorkflow: runWorkflow,
    _geom: geom
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
   Part 2 — "Office kit" in the PDF studio
   A panel (PS.panels.office) lists six jobs; each opens a full-height workbench over the studio. Entry points are added from
   here (start screen link, a card at the top of Tools, "Fill from my details" in Forms, office stamps in Edit), so no shared
   file changes. ?panel=office opens the list once the studio's deep-link wiring lands.
   ===================================================================== */
(function (global) {
  'use strict';

  var LE = global.LE || {};
  var PS = global.PS;
  var O = LE.pdfOffice;
  var d = global.document;
  if (!PS || !PS.panels || !PS.ui || !O) return;
  var S = PS.S;
  var ui = PS.ui, el = PS.el, esc = PS.esc, icon = PS.icon, $ = PS.$, $$ = PS.$$;

  function say(m, ms) { if (PS.say) PS.say(m, ms); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, ''); }
  function download(blob, name) { if (global.IT && IT.download) IT.download(blob, name); }
  function pdfBlob(bytes) { return new Blob([bytes], { type: 'application/pdf' }); }
  function fmtBytes(n) { return global.IT && IT.formatBytes ? IT.formatBytes(n) : Math.round(n / 1024) + ' KB'; }
  function copy(text, msg) { if (global.IT && IT.copy) IT.copy(text); else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { say(msg || 'Copied'); }); }

  var I = {
    kit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M5.5 9h2M5.5 13h2M16.5 9h2M16.5 13h2"/>',
    bundle: '<path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M8 3h8l4 4H4z"/><path d="M9 12h6"/>',
    stamp: '<path d="M5 21h14M6 17h12v-3a2 2 0 0 0-2-2h-2l-.5-3.5a3 3 0 1 0-3 0L10 12H8a2 2 0 0 0-2 2z"/>',
    flow: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h4a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M7 18h4a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3"/>',
    fingerprint: '<path d="M12 11v3a8 8 0 0 1-1.2 4.2M8.5 8.6A4 4 0 0 1 16 11v2.5M16 17.5c-.3 1.2-.8 2.4-1.4 3.4M5 15.5c.6-1.4 1-2.9 1-4.5a6 6 0 0 1 10.6-3.9M19.5 16c.3-1.6.5-3.3.5-5a8 8 0 0 0-1.4-4.5M3.5 12A8.5 8.5 0 0 1 5 7"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5L5 19"/>',
    divider: '<path d="M4 12h16M4 6h10M4 18h10"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', upload: '<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>', check: '<path d="M5 12.5l4.5 4.5L19.5 7"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'
  };
  function ic(name) {
    if (I[name]) return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[name] + '</svg>';
    return icon(name);
  }
  function h(tag, cls, html, attrs) {
    var n = el(tag, cls, html);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function button(cls, html, onClick, attrs) {
    var b = ui.btn(cls, html, attrs);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function note(text, cls) { return h('p', 'po-note' + (cls ? ' ' + cls : ''), esc(text)); }
  function step(n, title, sub) {
    var s = h('section', 'po-step');
    s.appendChild(h('h3', 'po-step-title', (n ? '<span class="po-step-n">' + n + '</span>' : '') + '<span>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'));
    return s;
  }
  function field(label, inputEl, hint) {
    var w = h('div', 'ps-field po-field');
    var id = 'po-' + PS.uid('f');
    var l = h('label', null, esc(label));
    l.htmlFor = id;
    inputEl.id = id;
    w.appendChild(l);
    w.appendChild(inputEl);
    if (hint) w.appendChild(h('small', 'po-hint', esc(hint)));
    return w;
  }
  function input(value, attrs) { return ui.inputEl((attrs && attrs.type) || 'text', value == null ? '' : value, attrs); }
  function runProgress(label) {
    var pr = PS.progress(label, true);
    return { onProgress: function (done, total, sub) { pr.set(done, total, sub); }, isCancelled: function () { return pr.cancelled(); }, end: function () { pr.end(); } };
  }
  function failSay(e, what) { if (e && e.cancelled) { say('Stopped'); return; } say((what ? what + ': ' : '') + (e && e.message ? e.message : e), 5200); }

  /* ---------- the open document ---------- */

  function docIds() {
    var ids = [];
    S.pages.forEach(function (r) { if (r.docId && ids.indexOf(r.docId) < 0) ids.push(r.docId); });
    return ids;
  }
  function currentDoc() {
    var cur = S.pages[S.current];
    var id = (cur && cur.docId) || docIds()[0];
    return id ? S.docs[id] : null;
  }
  function openName() { return PS.outName ? PS.outName() : 'document.pdf'; }
  /* The file as it was opened (exact bytes), for reading fields, comments and fingerprints. */
  function originalBytes() {
    var doc = currentDoc();
    return doc ? (doc.bytes ? doc.bytes() : doc._bytes.slice(0)) : null;
  }
  /* The document as it is now in the studio (edits applied), for packs and workflows. */
  async function currentBytes() {
    var ids = docIds();
    var single = ids.length === 1 ? S.docs[ids[0]] : null;
    var tools = PS.docToolOpts ? PS.docToolOpts() : {};
    var vals = single && S.formValues && S.formValues[single.id];
    var plain = single && S.pages.length === single.pageCount && !Object.keys(tools).length && !(vals && Object.keys(vals).length) && S.pages.every(function (r, i) {
      return r.docId === single.id && r.pageIndex === i && !((r.rotation || 0) % 360) && !(r.scene && r.scene.layers && r.scene.layers.some(function (l) { return l.visible !== false; }));
    });
    if (plain) return single.bytes();
    return PS.buildPdf({});
  }
  function hasDoc() { return !!(S.pages && S.pages.length > 0); }

  /* A file chooser: "Choose…" and "Open document". The chosen value is { name, open?, size?, bytes(): Promise<Uint8Array> }. */
  function filePick(label, opts, onChange) {
    opts = opts || {};
    var wrap = h('div', 'po-pick');
    var chosen = null;
    var line = h('div', 'po-pick-line', '<span class="po-pick-ic">' + ic('file') + '</span>');
    var name = h('span', 'po-pick-name', esc(opts.empty || 'No file chosen'));
    line.appendChild(name);
    var acts = h('div', 'po-pick-acts');
    var useOpen = button('btn btn-sm btn-ghost', ic('file') + '<span>Open document</span>', function () {
      set({ name: openName(), open: true, bytes: function () { return Promise.resolve(originalBytes()); } });
    }, { 'aria-label': label + ': use the document open in the studio' });
    var choose = button('btn btn-sm', ic('upload') + '<span>' + esc(opts.chooseLabel || 'Choose a PDF') + '</span>', function () {
      PS.pickFiles(opts.accept == null ? '.pdf,application/pdf' : opts.accept, false).then(function (files) {
        if (!files[0]) return;
        var f = files[0];
        set({ name: f.name, file: f, size: f.size, bytes: function () { return f.arrayBuffer().then(function (b) { return new Uint8Array(b); }); } });
      });
    }, { 'aria-label': label + ': choose a file' });
    acts.appendChild(choose);
    if (opts.allowOpen !== false) acts.appendChild(useOpen);
    wrap.appendChild(h('div', 'po-pick-label', esc(label)));
    wrap.appendChild(line);
    wrap.appendChild(acts);
    function set(v) {
      chosen = v;
      name.textContent = v ? v.name + (v.open ? ' (open in the studio)' : v.size ? ' · ' + fmtBytes(v.size) : '') : (opts.empty || 'No file chosen');
      wrap.classList.toggle('has-file', !!v);
      useOpen.hidden = !hasDoc() || !!(v && v.open);
      if (onChange) onChange(v);
    }
    wrap.get = function () { return chosen; };
    wrap.set = set;
    useOpen.hidden = !hasDoc();
    if (opts.preferOpen && hasDoc()) setTimeout(function () { useOpen.click(); }, 0);
    return wrap;
  }

  /* ---------- workbench ---------- */

  var JOBS = [
    { id: 'details', icon: 'person', title: 'Fill from my details', sub: 'Save your name, address and IDs once; fill any form in seconds.' },
    { id: 'compare', icon: 'compare', title: 'Compare two versions', sub: 'Every changed word, amount and date, plus a page-by-page picture view.' },
    { id: 'bundle', icon: 'bundle', title: 'Build a pack', sub: 'Several files into one, with a cover, contents, bookmarks and page numbers.' },
    { id: 'stamps', icon: 'stamp', title: 'Stamps and comment summary', sub: 'Approved, Paid, Received… with name and date. List every comment.' },
    { id: 'workflows', icon: 'flow', title: 'Saved workflows', sub: 'Number, watermark, compress and protect in one go, on one file or many.' },
    { id: 'fingerprint', icon: 'fingerprint', title: 'Fingerprint receipt', sub: 'A receipt with a code anyone can use to check a copy is unchanged.' }
  ];
  var W = null, current = null, RENDER = {};
  function workbench() {
    if (W) return W;
    W = h('section', 'po-work', '', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'po-work-title', hidden: '' });
    W.innerHTML = '<header class="po-head"><button class="ps-ib po-close" type="button" aria-label="Back to the studio">' + ic('back') + '</button>' +
      '<div class="po-head-text"><h2 id="po-work-title"></h2><p class="po-head-sub">' + ic('shield') + '<span>Runs on this device. Files never leave it.</span></p></div></header>' +
      '<div class="po-body"><div class="po-main"></div><aside class="po-side" aria-label="Preview"></aside></div>' +
      '<footer class="po-foot"><p class="po-foot-msg" aria-live="polite"></p><div class="po-foot-acts"></div></footer>';
    d.body.appendChild(W);
    $('.po-close', W).addEventListener('click', closeJob);
    W.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !d.querySelector('dialog[open]')) { e.stopPropagation(); closeJob(); } });
    return W;
  }
  function openJob(id, opts) {
    var w = workbench();
    if (current && current.destroy) current.destroy();
    var job = JOBS.filter(function (j) { return j.id === id; })[0];
    if (!job) return;
    $('#po-work-title', w).textContent = job.title;
    var main = $('.po-main', w), side = $('.po-side', w), acts = $('.po-foot-acts', w), msg = $('.po-foot-msg', w);
    main.innerHTML = ''; side.innerHTML = ''; acts.innerHTML = ''; msg.textContent = '';
    w.setAttribute('data-job', id);
    w.hidden = false;
    d.body.classList.add('po-open');
    if (PS.isPhone && PS.isPhone() && PS.setSheet) PS.setSheet('closed');
    current = RENDER[id]({ main: main, side: side, acts: acts, msg: msg, job: job, opts: opts || {} }) || {};
    $('.po-body', w).scrollTop = 0;
    setTimeout(function () { var f = $('.po-close', w); if (f) f.focus(); }, 30);
  }
  function closeJob() {
    if (!W || W.hidden) return;
    if (current && current.destroy) current.destroy();
    current = null;
    $$('input[type="password"]', W).forEach(function (i) { i.value = ''; });
    $('.po-main', W).innerHTML = '';
    $('.po-side', W).innerHTML = '';
    W.hidden = true;
    d.body.classList.remove('po-open');
  }
  function setPrimary(ctx, label, onClick, disabled) {
    var old = $('.po-go', ctx.acts);
    if (old) old.remove();
    var b = button('btn btn-gold po-go', esc(label), onClick);
    b.disabled = !!disabled;
    ctx.acts.appendChild(b);
    return b;
  }
  function addSecondary(ctx, label, onClick) {
    var b = button('btn btn-ghost', esc(label), onClick);
    ctx.acts.insertBefore(b, ctx.acts.firstChild);
    return b;
  }
  function sideCard(title, lines) {
    var c = h('div', 'po-callout');
    c.appendChild(h('strong', null, esc(title)));
    var ul = h('ul');
    lines.forEach(function (l) { ul.appendChild(h('li', null, esc(l))); });
    c.appendChild(ul);
    return c;
  }

  /* ---------- panel and entry points ---------- */

  function jobList(compact) {
    var list = h('div', 'po-jobs' + (compact ? ' is-compact' : ''));
    JOBS.forEach(function (j) {
      list.appendChild(button('po-job', '<span class="po-job-ic">' + ic(j.icon) + '</span><span class="po-job-text"><strong>' + esc(j.title) + '</strong>' + (compact ? '' : '<small>' + esc(j.sub) + '</small>') + '</span>' + ic('chevron'), function () { openJob(j.id); }, { 'data-office-job': j.id }));
    });
    return list;
  }
  PS.panels.office = {
    title: 'Office kit', icon: 'checklist', tone: 'sapphire', snap: 'half', noDoc: true,
    build: function (pane) {
      pane.appendChild(h('p', 'ps-note ps-lead', 'Everyday office jobs, for files you would rather not upload.'));
      pane.appendChild(jobList(false));
      pane.appendChild(h('p', 'po-private', ic('shield') + '<span>Files never leave this device.</span>'));
    }
  };
  function wrapPanel(name, after) {
    var p = PS.panels[name];
    if (!p || p._poWrapped) return;
    p._poWrapped = true;
    var b = p.build, r = p.render;
    p.build = function (pane) { b.call(this, pane); if (after.build) after.build.call(this, pane); };
    if (r && after.render) p.render = function () { r.apply(this, arguments); after.render.call(this, this.pane); };
  }
  function addEntryPoints() {
    var starts = $('.ps-empty .ps-starts');
    if (starts && !$('.po-entry')) {
      var link = button('po-entry', ic('kit') + '<span><strong>Office kit</strong> · fill from my details, compare, packs, stamps, workflows, fingerprints</span>' + ic('chevron'), function () { PS.openPanel('office'); }, { 'data-act-office': 'open' });
      var after = $('.pb-entry') || starts;
      after.parentNode.insertBefore(link, after.nextSibling);
    }
  }
  wrapPanel('tools', {
    build: function (pane) {
      var c = h('section', 'ps-sec po-tools-card');
      c.appendChild(h('h3', 'ps-sec-title', 'Office kit<small>compare, packs, stamps, workflows</small>'));
      c.appendChild(jobList(true));
      pane.insertBefore(c, pane.firstChild);
    }
  });
  wrapPanel('forms', {
    render: function (pane) {
      if (!pane || $('.po-forms-cta', pane)) return;
      var fields = PS.fieldsOnDoc ? PS.fieldsOnDoc() : [];
      var b = button('btn btn-sm po-forms-cta', ic('person') + '<span>' + (fields.length ? 'Fill from my details' : 'Stamp my details') + '</span>', function () { openJob('details'); });
      pane.insertBefore(b, pane.firstChild);
    }
  });
  wrapPanel('edit', {
    build: function (pane) {
      var s = h('section', 'ps-sec po-edit-stamps');
      s.appendChild(h('h3', 'ps-sec-title', 'Office stamps<small>with your name and the date</small>'));
      var row = h('div', 'po-stamp-row');
      O.stampPresets.slice(0, 4).forEach(function (p) {
        var b = button('ps-chip po-stamp-chip', esc(p.text.charAt(0) + p.text.slice(1).toLowerCase()), function () { armStamp({ preset: p.id, date: true, name: defaultName() }); });
        b.style.setProperty('--c', p.color);
        row.appendChild(b);
      });
      row.appendChild(button('ps-chip', 'More stamps…', function () { openJob('stamps'); }));
      s.appendChild(row);
      pane.appendChild(s);
    }
  });

  /* =====================================================================
     D11 — My details
     ===================================================================== */

  var GROUPS = [['name', 'Name'], ['address', 'Address'], ['contact', 'Contact'], ['personal', 'Personal'], ['work', 'Work and tax'], ['bank', 'Bank']];
  function defaultName() {
    var p = O.details.list()[0];
    return p ? O.details.value(p, 'fullName') : '';
  }
  function niceToday() { try { return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return new Date().toDateString(); } }
  PS.placers['po-text'] = function (pt, ref) {
    var o = S.toolOpts || {};
    if (!o.text) return null;
    var STY = PS.STYLE || {};
    var size = STY.size || 12;
    var w = Math.max(40, String(o.text).length * size * 0.58 + 12), hh = Math.round(size * 1.45);
    var sz = PS.refSize(ref);
    var x = PS.clamp(pt.x - 4, 0, Math.max(0, sz.w - w)), y = PS.clamp(pt.y - hh / 2, 0, Math.max(0, sz.h - hh));
    return { layer: { type: 'text', name: o.name || 'My details', text: String(o.text), x: x, y: y, w: w, h: hh, size: size, font: STY.font || 'Plus Jakarta Sans', weight: 400, color: STY.textColor || '#17131F', lineHeight: 1.2 } };
  };
  function showHint(text) {
    var hint = PS.E && PS.E.hint;
    if (hint) { hint.hidden = false; hint.textContent = text; }
  }
  function armText(text, name) {
    closeJob();
    PS.setTool('po-text', { text: text, name: name });
    showHint((PS.isPhone() ? 'Tap' : 'Click') + ' where “' + String(text).slice(0, 24) + '” goes');
    if (PS.isPhone()) PS.setSheet('closed');
  }
  async function sigCanvas(id) {
    var list = await LE.pdf.signatures.list();
    var s = list.filter(function (x) { return x.id === id; })[0];
    if (!s) return null;
    var img = new Image();
    img.src = s.png;
    await img.decode();
    var c = d.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }
  function valueFor(p, key, r) {
    if (key === 'today' || key === 'dob') {
      var rows = O.propose([{ name: key === 'today' ? 'Date' : 'Date of birth', tooltip: r ? (r.name + ' ' + (r.label || '')) : '', type: 'text', page: 0 }], p);
      return rows[0].value;
    }
    return O.details.value(p, key);
  }

  RENDER.details = function (ctx) {
    var st = { profileId: null, fields: null, fieldsFor: null, fp: null };
    var first = O.details.list()[0];
    st.profileId = first ? first.id : null;
    var s1 = step(1, 'Your details', 'saved only in this browser');
    var chips = h('div', 'po-chips', '', { role: 'radiogroup', 'aria-label': 'Saved details' });
    var editor = h('div', 'po-editor');
    s1.appendChild(chips);
    s1.appendChild(editor);
    var tools = h('div', 'po-row-acts');
    tools.appendChild(button('btn btn-sm btn-ghost', ic('download') + '<span>Export</span>', function () {
      if (!O.details.list().length) { say('Nothing saved yet'); return; }
      download(new Blob([O.details.exportText()], { type: 'application/json' }), 'my-details.json');
      ctx.msg.textContent = 'The exported file contains your details in plain text. Keep it somewhere private.';
    }));
    tools.appendChild(button('btn btn-sm btn-ghost', ic('upload') + '<span>Import</span>', function () {
      PS.pickFiles('.json,application/json', false).then(function (f) {
        if (!f[0]) return;
        f[0].text().then(function (t) {
          var r = O.details.importText(t);
          if (!r.ok) { say(r.errors[0], 4200); return; }
          say(plural(r.profiles.length, 'set') + ' of details imported');
          st.profileId = r.profiles[0].id;
          drawChips(); drawEditor(); drawStep2();
        });
      });
    }));
    tools.appendChild(button('btn btn-sm btn-ghost po-danger', ic('trash') + '<span>Erase all</span>', function () {
      PS.dialog({ title: 'Erase all saved details?', text: 'This removes every set of details and every remembered form from this browser. It cannot be undone.', ok: 'Erase' }).then(function (ok) {
        if (!ok) return;
        O.details.eraseAll();
        st.profileId = null;
        drawChips(); drawEditor(); drawStep2();
        say('Saved details erased');
      });
    }, { 'data-po': 'erase-details' }));
    s1.appendChild(tools);
    s1.appendChild(note('Stored only in this browser on this device and never uploaded. Storage (in the menu) lists it under Settings, where it can also be cleared.'));
    ctx.main.appendChild(s1);
    var s2 = step(2, 'Fill this document');
    ctx.main.appendChild(s2);

    function profile() { return st.profileId ? O.details.get(st.profileId) : null; }
    function drawChips() {
      chips.innerHTML = '';
      O.details.list().forEach(function (p) {
        chips.appendChild(button('ps-chip po-chip', esc(p.label), function () { st.profileId = p.id; st.editing = false; drawChips(); drawEditor(); drawStep2(); }, { role: 'radio', 'aria-checked': String(p.id === st.profileId) }));
      });
      chips.appendChild(button('ps-chip po-chip po-chip-add', ic('plus') + '<span>New set</span>', function () { st.profileId = null; drawChips(); drawEditor(true); }, { 'data-po': 'new-details' }));
    }
    function drawEditor(fresh) {
      editor.innerHTML = '';
      var p = profile();
      if (!p && !fresh && O.details.list().length) { p = O.details.list()[0]; st.profileId = p.id; }
      if (p && !fresh && !st.editing) {
        var card = h('div', 'po-profile');
        var lines = [O.details.value(p, 'fullName'), O.details.value(p, 'address'), O.details.value(p, 'cityLine'), [p.fields.email, O.details.value(p, 'phone')].filter(Boolean).join(' · '), p.fields.company].filter(Boolean);
        var n = Object.keys(p.fields).length + p.ids.length;
        card.appendChild(h('strong', null, esc(lines[0] || p.label)));
        lines.slice(1, 4).forEach(function (l) { card.appendChild(h('span', null, esc(l))); });
        card.appendChild(h('small', null, esc(plural(n, 'detail') + ' saved' + (p.signatureId ? ' · signature linked' : ''))));
        var row = h('div', 'po-row-acts');
        row.appendChild(button('btn btn-sm', ic('edit') + '<span>Edit these details</span>', function () { st.editing = true; drawEditor(); }, { 'data-po': 'edit-details' }));
        card.appendChild(row);
        editor.appendChild(card);
        return;
      }
      var data = p ? JSON.parse(JSON.stringify(p)) : { label: O.details.list().length ? 'Another person' : 'Me', kind: 'person', fields: {}, ids: [] };
      var form = h('form', 'po-detail-form');
      form.addEventListener('submit', function (e) { e.preventDefault(); });
      var lab = input(data.label, { autocomplete: 'off', maxlength: '60', 'data-k': 'label' });
      form.appendChild(field('Name of this set', lab, 'For example: Me, Company, My mother'));
      var inputs = {};
      var meta = O.details.fields();
      GROUPS.forEach(function (g, gi) {
        var det = h('details', 'po-group');
        var count = meta.filter(function (m) { return m.group === g[0] && data.fields[m.id]; }).length;
        if (gi < 2 || (count && gi < 3)) det.open = true;
        det.appendChild(h('summary', null, '<span>' + esc(g[1]) + '</span><small>' + (count ? count + ' saved' : '') + '</small>'));
        var grid = h('div', 'po-grid');
        meta.filter(function (m) { return m.group === g[0]; }).forEach(function (m) {
          var type = m.id === 'email' ? 'email' : m.id === 'dob' ? 'date' : /phone|mobile/.test(m.id) ? 'tel' : 'text';
          var i = input(data.fields[m.id] || '', { type: type, autocomplete: 'off', spellcheck: 'false', 'data-k': m.id });
          inputs[m.id] = i;
          grid.appendChild(field(m.label, i));
        });
        det.appendChild(grid);
        form.appendChild(det);
      });
      var idDet = h('details', 'po-group');
      idDet.appendChild(h('summary', null, '<span>IDs you choose to add</span><small>' + (data.ids.length ? data.ids.length + ' saved' : 'passport, licence, staff number…') + '</small>'));
      var idList = h('div', 'po-ids');
      function idRow(x) {
        var row = h('div', 'po-id-row');
        row.appendChild(input(x.label, { placeholder: 'What it is', 'aria-label': 'ID name', autocomplete: 'off' }));
        row.appendChild(input(x.value, { placeholder: 'Number', 'aria-label': 'ID number', autocomplete: 'off', spellcheck: 'false' }));
        row.appendChild(button('ps-ib', ic('x'), function () { row.remove(); }, { 'aria-label': 'Remove this ID' }));
        idList.appendChild(row);
      }
      data.ids.forEach(idRow);
      idDet.appendChild(idList);
      idDet.appendChild(button('btn btn-sm btn-ghost', ic('plus') + '<span>Add an ID</span>', function () { idRow({ label: '', value: '' }); }));
      form.appendChild(idDet);
      var sigDet = h('details', 'po-group');
      sigDet.appendChild(h('summary', null, '<span>Signature</span><small>one of the studio’s saved signatures</small>'));
      var sigRow = h('div', 'po-sigs');
      sigDet.appendChild(sigRow);
      var sigId = data.signatureId || null;
      LE.pdf.signatures.list().then(function (list) {
        if (!list.length) { sigRow.appendChild(note('No saved signatures yet. Make one in Sign, then pick it here.')); return; }
        list.slice(0, 8).forEach(function (s) {
          var b = button('po-sig', '<img alt="">', function () { sigId = sigId === s.id ? null : s.id; mark(); }, { 'aria-label': 'Use signature ' + s.name, 'data-id': s.id });
          $('img', b).src = s.png;
          sigRow.appendChild(b);
        });
        function mark() { $$('.po-sig', sigRow).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === sigId)); }); }
        mark();
      }).catch(function () { sigRow.appendChild(note('Saved signatures are not available in this browser.')); });
      form.appendChild(sigDet);
      var acts = h('div', 'po-row-acts');
      acts.appendChild(button('btn btn-sm', ic('check') + '<span>Save details</span>', function () {
        var fields = {};
        Object.keys(inputs).forEach(function (k) { if (inputs[k].value.trim()) fields[k] = inputs[k].value.trim(); });
        var ids = $$('.po-id-row', idList).map(function (r) { var i2 = $$('input', r); return { label: i2[0].value, value: i2[1].value }; }).filter(function (x) { return x.label.trim() && x.value.trim(); });
        try {
          var saved = O.details.save({ id: p ? p.id : undefined, label: lab.value, kind: 'person', fields: fields, ids: ids, signatureId: sigId });
          st.profileId = saved.id; st.editing = false; drawEditor();
          drawChips(); drawStep2();
          say('Details saved on this device');
        } catch (e) { say(e.message, 4200); }
      }, { 'data-po': 'save-details' }));
      if (p) acts.appendChild(button('btn btn-sm btn-ghost po-danger', ic('trash') + '<span>Delete this set</span>', function () {
        O.details.remove(p.id);
        st.profileId = null;
        drawChips(); drawEditor(); drawStep2();
      }));
      form.appendChild(acts);
      editor.appendChild(form);
    }

    async function drawStep2() {
      var title = $('.po-step-title', s2);
      s2.innerHTML = '';
      s2.appendChild(title);
      ctx.side.innerHTML = '';
      setPrimary(ctx, 'Fill the form', null, true);
      var p = profile();
      if (!hasDoc()) { s2.appendChild(note('Open a PDF in the studio to fill it from these details.')); ctx.side.appendChild(privacyCard()); return; }
      if (!p) { s2.appendChild(note('Save your details above first.')); ctx.side.appendChild(privacyCard()); return; }
      var doc = currentDoc();
      if (!st.fields || st.fieldsFor !== doc.id) {
        s2.appendChild(note('Reading the form…'));
        try { st.fields = await O.formFields(originalBytes()); } catch (e) { st.fields = []; }
        st.fieldsFor = doc.id;
        st.fp = st.fields.length ? await O.formFingerprint(st.fields) : null;
        s2.innerHTML = ''; s2.appendChild(title);
      }
      if (!st.fields.length) { drawChips2(p); ctx.side.appendChild(privacyCard()); return; }
      var memory = st.fp ? O.mappings.get(st.fp) : null;
      var rows = O.propose(st.fields, p, { memory: memory });
      var auto = rows.filter(function (r) { return !r.skip; }).length;
      s2.appendChild(note(plural(st.fields.length, 'field') + ' in this form. ' + (auto ? auto + ' can be filled from “' + p.label + '”.' : 'None matched on their own; pick a detail for any field below.') + (memory ? ' Your earlier corrections for this form are used.' : '') + ' Check each value before filling.'));
      var table = h('div', 'po-review', '', { role: 'list', 'aria-label': 'Proposed values' });
      var opts = [['', 'Don’t fill']].concat(O.details.fields().map(function (m) { return [m.id, m.label]; })).concat([['fullName', 'Full name (joined)'], ['today', 'Today’s date']]).concat((p.ids || []).map(function (x, i) { return ['id:' + i, x.label]; }));
      rows.forEach(function (r) {
        var locked = r.skip === 'signature' || r.skip === 'password' || r.skip === 'read-only' || (r.skip === 'never' && r.source !== 'memory');
        var row = h('div', 'po-rev-row' + (locked ? ' is-locked' : ''), '', { role: 'listitem', 'data-field': r.name });
        var nameTxt = r.label && r.label !== r.name ? r.label : r.name.replace(/[._]/g, ' ');
        row.appendChild(h('div', 'po-rev-name', '<strong></strong><small></small>'));
        $('strong', row).textContent = nameTxt;
        $('small', row).textContent = 'Page ' + (r.page + 1) + (r.label && r.label !== r.name ? ' · field “' + r.name + '”' : '') + (r.source === 'memory' ? ' · remembered' : r.source === 'label' ? ' · matched by its label' : '');
        if (locked) {
          var why = r.skip === 'password' ? 'Password field: never filled.' : r.skip === 'read-only' ? 'Read-only field.' : 'Signature field: never filled for you. Sign it yourself.';
          row.appendChild(h('div', 'po-rev-lock', ic('shield') + '<span>' + esc(why) + '</span>'));
          table.appendChild(row);
          return;
        }
        var sel = ui.selectEl(opts, r.key || '');
        sel.setAttribute('aria-label', 'Detail for ' + nameTxt);
        var val = r.options && r.options.length ? ui.selectEl([['', '—']].concat(r.options.map(function (o) { return [o, o]; })), r.value) : input(r.value, { autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Value for ' + nameTxt });
        var on = ui.inputEl('checkbox', null, { 'aria-label': 'Fill ' + nameTxt });
        on.checked = !r.skip && !!r.value;
        sel.addEventListener('change', function () {
          var k = sel.value;
          var v = k ? valueFor(p, k, r) : '';
          if (val.tagName === 'SELECT') { var m = r.options.filter(function (o) { return o.toLowerCase() === String(v).toLowerCase(); })[0]; val.value = m || ''; }
          else val.value = v;
          on.checked = !!k && !!val.value;
          row._changed = true;
          countUpdate();
        });
        val.addEventListener('input', function () { on.checked = !!val.value; countUpdate(); });
        val.addEventListener('change', function () { on.checked = !!val.value; countUpdate(); });
        on.addEventListener('change', countUpdate);
        row._r = r; row._sel = sel; row._val = val; row._on = on;
        var ctl = h('div', 'po-rev-ctl');
        ctl.appendChild(sel); ctl.appendChild(val);
        var lbl = h('label', 'po-rev-on');
        lbl.appendChild(on);
        lbl.appendChild(h('span', 'po-rev-on-t', 'Fill'));
        row.appendChild(ctl);
        row.appendChild(lbl);
        if (r.trimmed) row.appendChild(note('Shortened to fit this field (' + r.maxLen + ' characters).', 'po-warn'));
        if (r.skip === 'no-option') row.appendChild(note('“' + r.value + '” is not one of this field’s choices. Pick one.', 'po-warn'));
        table.appendChild(row);
      });
      s2.appendChild(table);
      var remember = ui.toggle('Remember my changes for this form', true, function () {}, 'Only which detail goes in which field is kept, not the form or the answers.');
      s2.appendChild(remember);
      ctx.side.appendChild(sideCard('What happens', ['Values go into the form fields here in the studio. Nothing is saved until you press Save PDF.', 'Signature and password fields are never filled for you.', 'Untick any field to leave it alone.']));
      ctx.side.appendChild(privacyCard());
      var go = setPrimary(ctx, 'Fill the form', function () {
        var vals = S.formValues[doc.id] || (S.formValues[doc.id] = {});
        var mem = {}, n = 0, unicode = false;
        $$('.po-rev-row', table).forEach(function (row) {
          if (!row._r) return;
          var r = row._r;
          if (row._changed || r.source === 'memory') mem[r.name] = row._sel.value;
          if (!row._on.checked || !row._val.value) return;
          vals[r.name] = row._val.value;
          if (!/^[\x20-\x7e -ÿ]*$/.test(row._val.value)) unicode = true;
          n++;
        });
        if (remember.input.checked && st.fp && Object.keys(mem).length) O.mappings.remember(st.fp, mem);
        PS.markDirty();
        if (PS.refreshOverlays) PS.refreshOverlays();
        if (PS.panels.forms && PS.panels.forms.pane) PS.panels.forms.render();
        say(plural(n, 'field') + ' filled from “' + p.label + '”. Check them, then Save PDF.');
        if (unicode) {
          PS.dialog({ title: 'Some letters need another font', text: 'One or more answers use letters the standard PDF font cannot show (for example Ł or ő). Download the filled form from here so they show correctly.', ok: 'Download filled form', cancel: 'Not now' }).then(function (ok) {
            if (!ok) return;
            O.fill(originalBytes(), vals).then(function (bytes) { download(pdfBlob(bytes), baseName(openName()) + '-filled.pdf'); }).catch(function (e) { failSay(e, 'Could not fill'); });
          });
        }
        closeJob();
      });
      function countUpdate() {
        var n = $$('.po-rev-row', table).filter(function (r) { return r._on && r._on.checked; }).length;
        go.disabled = !n;
        go.textContent = n ? 'Fill ' + plural(n, 'field') : 'Fill the form';
      }
      countUpdate();
    }
    function privacyCard() { return sideCard('Your details stay here', ['Saved in this browser only, never sent anywhere.', 'Export them to a file to move them to another device; that file is not protected, so keep it private.', 'Erase all removes every set and every remembered form.']); }
    function drawChips2(p) {
      s2.appendChild(note('This PDF has no fillable fields. Tap a detail, then tap the page where it goes. Each one becomes a text box you can move, resize or delete.'));
      var wrap = h('div', 'po-chips po-stamp-details');
      var keys = ['fullName', 'address1', 'address2', 'city', 'postcode', 'country', 'phone', 'mobile', 'email', 'dob', 'company', 'jobTitle', 'companyNumber', 'taxId', 'vatNumber', 'bankName', 'accountName', 'accountNumber', 'sortCode', 'iban', 'swift'];
      var labels = {};
      O.details.fields().forEach(function (m) { labels[m.id] = m.label.replace(/ \(.*\)$/, ''); });
      labels.fullName = 'Name';
      keys.forEach(function (k) {
        var v = valueFor(p, k);
        if (!v || (k === 'mobile' && v === valueFor(p, 'phone'))) return;
        var b = button('ps-chip po-chip po-detail-chip', '<small>' + esc(labels[k]) + '</small><span></span>', function () { armText(v, labels[k]); }, { 'data-k': k });
        $('span', b).textContent = v;
        wrap.appendChild(b);
      });
      (p.ids || []).forEach(function (x) {
        var b = button('ps-chip po-chip po-detail-chip', '<small></small><span></span>', function () { armText(x.value, x.label); });
        $('small', b).textContent = x.label; $('span', b).textContent = x.value;
        wrap.appendChild(b);
      });
      wrap.appendChild(button('ps-chip po-chip po-detail-chip', '<small>Date</small><span>Today</span>', function () { armText(niceToday(), 'Date'); }));
      if (p.signatureId) wrap.appendChild(button('ps-chip po-chip po-detail-chip', '<small>Signature</small><span>Saved signature</span>', function () {
        sigCanvas(p.signatureId).then(function (c) {
          if (!c) { say('That signature is no longer saved'); return; }
          closeJob();
          PS.setTool('sign', { canvas: c, key: PS.uid('sig'), name: 'Signature', width: 150 });
          if (PS.isPhone()) PS.setSheet('closed');
        });
      }));
      s2.appendChild(wrap);
    }
    drawChips();
    drawEditor();
    drawStep2();
    return {};
  };

  /* =====================================================================
     D14 — compare
     ===================================================================== */

  var TYPE_LABEL = { added: 'Added', removed: 'Removed', replaced: 'Changed', moved: 'Moved' };
  var SPECIAL = { amount: 'Amount', date: 'Date', percent: 'Percentage', number: 'Number' };
  RENDER.compare = function (ctx) {
    var st = { res: null, ba: null, bb: null, pa: null, pb: null, pair: 0, mode: 'side', filter: 'all', blink: null, cache: {}, focus: null };
    ctx.acts.innerHTML = '';
    var s1 = step(1, 'Choose the two versions');
    var pickA = filePick('Original (older)', { preferOpen: true }, ready2);
    var pickB = filePick('New version', {}, ready2);
    s1.appendChild(pickA); s1.appendChild(pickB);
    s1.appendChild(note('Words are compared in reading order, so text that only moved to another line or page is not reported. Scanned pages can only be compared as pictures.'));
    ctx.main.appendChild(s1);
    var s2 = step(2, 'What changed');
    s2.hidden = true;
    ctx.main.appendChild(s2);
    var go = setPrimary(ctx, 'Compare', run, true);
    function ready2() { go.disabled = !(pickA.get() && pickB.get()); }
    ctx.side.appendChild(h('div', 'po-empty-side', ic('compare') + '<p>Pick two versions of a document. The changes and a page-by-page view appear here.</p>'));
    async function run() {
      var pr = runProgress('Comparing');
      try {
        st.ba = await pickA.get().bytes();
        st.bb = await pickB.get().bytes();
        st.res = await O.compare(st.ba, st.bb, { nameA: pickA.get().name, nameB: pickB.get().name, onProgress: pr.onProgress, isCancelled: pr.isCancelled });
        try { if (st.pa) st.pa.destroy(); if (st.pb) st.pb.destroy(); } catch (e) {}
        st.pa = await global.pdfjsLib.getDocument({ data: st.ba.slice(0), isEvalSupported: false }).promise;
        st.pb = await global.pdfjsLib.getDocument({ data: st.bb.slice(0), isEvalSupported: false }).promise;
        st.cache = {};
        pr.end();
        showResult();
      } catch (e) { pr.end(); failSay(e, 'Could not compare'); }
    }
    function showResult() {
      var r = st.res;
      s2.hidden = false;
      s1.hidden = true;
      var title = $('.po-step-title', s2);
      s2.innerHTML = '';
      s2.appendChild(title);
      var head = h('div', 'po-cmp-head', '<strong></strong><small></small>');
      $('strong', head).textContent = r.summary.text;
      var files = h('span', 'po-cmp-files', '<span></span> <span aria-hidden="true">→</span> <span></span>');
      $$('span', files)[0].textContent = pickA.get().name;
      $$('span', files)[2].textContent = pickB.get().name;
      head.insertBefore(files, head.firstChild);
      var bt = r.summary.byType;
      $('small', head).textContent = [bt.replaced ? bt.replaced + ' changed' : '', bt.added ? bt.added + ' added' : '', bt.removed ? bt.removed + ' removed' : '', bt.moved ? bt.moved + ' moved' : ''].filter(Boolean).join(' · ') || (r.textCompared ? 'The words are the same' : 'No text to compare');
      s2.appendChild(head);
      if (r.summary.special.length) {
        var sp = h('div', 'po-special');
        sp.appendChild(h('strong', null, ic('alert') + '<span>Numbers, amounts and dates that changed</span>'));
        r.summary.special.forEach(function (x) {
          var cb = (x.contextBefore || '').split(' ').slice(-2).join(' '), ca = (x.contextAfter || '').split(' ').slice(0, 2).join(' ');
          var b = button('po-special-row', '<span class="po-tag"></span><span class="po-sp-side"><span class="po-ctx"></span> <span class="po-was"></span> <span class="po-ctx"></span></span><span class="po-arrow" aria-hidden="true">→</span><span class="po-sp-side"><span class="po-ctx"></span> <span class="po-now"></span> <span class="po-ctx"></span></span>', function () { jump(x.id); });
          $('.po-tag', b).textContent = SPECIAL[x.kind];
          $('.po-was', b).textContent = x.before || '(none)';
          $('.po-now', b).textContent = x.after || '(none)';
          $$('.po-ctx', b).forEach(function (n, k) { n.textContent = k % 2 ? ca : cb; });
          b.setAttribute('aria-label', SPECIAL[x.kind] + ' changed from ' + (x.before || 'nothing') + ' to ' + (x.after || 'nothing'));
          sp.appendChild(b);
        });
        s2.appendChild(sp);
      }
      (r.notes || []).forEach(function (n) { s2.appendChild(note(n, 'po-warn')); });
      if (r.changes.length) {
        var filters = ui.seg([['all', 'All'], ['special', 'Numbers'], ['replaced', 'Changed'], ['added', 'Added'], ['removed', 'Removed'], ['moved', 'Moved']], st.filter, function (v) { st.filter = v; drawList(); });
        filters.classList.add('po-seg-wrap');
        filters.setAttribute('aria-label', 'Show');
        s2.appendChild(filters);
      }
      var list = h('ol', 'po-changes', '', { 'aria-label': 'Changes' });
      s2.appendChild(list);
      function drawList() {
        list.innerHTML = '';
        r.changes.filter(function (c) { return st.filter === 'all' || (st.filter === 'special' ? !!c.special : c.type === st.filter); }).forEach(function (c) {
          var li = h('li');
          var b = button('po-change t-' + c.type, '<span class="po-change-head"><span class="po-tag"></span><small></small></span><span class="po-change-text"></span>', function () { jump(c.id); }, { 'data-change': c.id });
          $('.po-tag', b).textContent = TYPE_LABEL[c.type] + (c.special ? ' · ' + SPECIAL[c.special] : '');
          $('small', b).textContent = c.pagesB.length ? 'Page ' + (c.pagesB[0] + 1) : 'Old page ' + (c.pagesA[0] + 1);
          var t = $('.po-change-text', b);
          if (c.type === 'replaced') { t.appendChild(h('del', null, esc(c.before.slice(0, 220)))); t.appendChild(d.createTextNode(' → ')); t.appendChild(h('ins', null, esc(c.after.slice(0, 220)))); }
          else if (c.type === 'removed') t.appendChild(h('del', null, esc(c.before.slice(0, 300))));
          else if (c.type === 'added') t.appendChild(h('ins', null, esc(c.after.slice(0, 300))));
          else { t.appendChild(h('span', 'po-moved', esc(c.after.slice(0, 300)))); t.appendChild(h('small', 'po-moved-from', esc('Moved from old page ' + (c.pagesA[0] + 1) + (c.exact ? '' : ', with small edits')))); }
          li.appendChild(b);
          list.appendChild(li);
        });
        if (!list.childNodes.length) list.appendChild(h('li', 'po-note', esc(r.changes.length ? 'No changes of this kind.' : (r.textCompared ? 'No differences in the words. Use the picture view for layout, images and signatures.' : 'No text to compare.'))));
      }
      drawList();
      ctx.acts.innerHTML = '';
      addSecondary(ctx, 'Start again', function () { closeJob(); openJob('compare'); });
      setPrimary(ctx, 'Download report', report);
      ctx.msg.textContent = 'Compared word by word on this device. Check anything important against the documents themselves.';
      var firstPair = r.alignment.findIndex(function (p) { return r.changes.some(function (c) { return (p[1] != null && c.pagesB.indexOf(p[1]) >= 0) || (p[0] != null && c.pagesA.indexOf(p[0]) >= 0); }); });
      st.pair = Math.max(0, firstPair);
      drawVisual();
    }
    function jump(id) {
      var c = st.res.changes.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      var idx = st.res.alignment.findIndex(function (p) { return (c.pagesB.length && p[1] === c.pagesB[0]) || (!c.pagesB.length && p[0] === c.pagesA[0]); });
      if (idx >= 0) st.pair = idx;
      st.focus = id;
      $$('.po-change', ctx.main).forEach(function (b) { b.setAttribute('aria-current', String(b.getAttribute('data-change') === id)); });
      drawVisual().then(function () { if (PS.isPhone()) ctx.side.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }
    async function pageCanvas(which, index) {
      var key = which + index;
      if (st.cache[key]) return st.cache[key];
      var pdf = which === 'a' ? st.pa : st.pb;
      var size = (which === 'a' ? st.res.a.sizes : st.res.b.sizes)[index];
      var scale = Math.min(2, 1000 / Math.max(size.w, size.h));
      st.cache[key] = { canvas: await O.renderPage(pdf, index, scale), scale: scale };
      return st.cache[key];
    }
    var drawing = 0;
    async function drawVisual() {
      var r = st.res, my = ++drawing;
      clearInterval(st.blink);
      var pair = r.alignment[st.pair] || [null, null];
      var A = pair[0] != null ? await pageCanvas('a', pair[0]) : null;
      var B = pair[1] != null ? await pageCanvas('b', pair[1]) : null;
      if (my !== drawing) return;
      ctx.side.innerHTML = '';
      var bar = h('div', 'po-vis-bar');
      var modes = ui.seg([['side', 'Side by side'], ['overlay', 'Overlay'], ['blink', 'Blink'], ['diff', 'Difference']], st.mode, function (v) { st.mode = v; drawVisual(); });
      modes.classList.add('po-seg-wrap');
      modes.setAttribute('aria-label', 'Picture view');
      bar.appendChild(modes);
      var nav = h('div', 'po-vis-nav');
      var prev = button('ps-ib', ic('back'), function () { if (st.pair > 0) { st.pair--; drawVisual(); } }, { 'aria-label': 'Previous pages' });
      var next = button('ps-ib', ic('chevron'), function () { if (st.pair < r.alignment.length - 1) { st.pair++; drawVisual(); } }, { 'aria-label': 'Next pages' });
      var lab = h('span', 'po-vis-label', esc((pair[0] != null ? 'Old p. ' + (pair[0] + 1) : 'Not in the old version') + ' · ' + (pair[1] != null ? 'New p. ' + (pair[1] + 1) : 'Not in the new version')));
      prev.disabled = st.pair <= 0; next.disabled = st.pair >= r.alignment.length - 1;
      nav.appendChild(prev); nav.appendChild(lab); nav.appendChild(next);
      bar.appendChild(nav);
      ctx.side.appendChild(bar);
      var stage = h('div', 'po-vis po-vis-' + st.mode);
      ctx.side.appendChild(stage);
      function frame(x, which, index, label) {
        var f = h('figure', 'po-frame');
        if (!x) f.appendChild(h('div', 'po-frame-none', esc(which === 'a' ? 'This page is new' : 'This page was removed')));
        else {
          var c = d.createElement('canvas');
          c.width = x.canvas.width; c.height = x.canvas.height;
          var g = c.getContext('2d');
          g.drawImage(x.canvas, 0, 0);
          r.changes.forEach(function (ch) {
            if ((which === 'a' && ch.type === 'added') || (which === 'b' && ch.type === 'removed')) return;
            var rects = which === 'a' ? ch.rectsA : ch.rectsB;
            var col = ch.type === 'moved' ? '43,89,195' : which === 'a' ? '180,35,24' : ch.type === 'added' ? '27,127,84' : '199,119,0';
            rects.forEach(function (rc) {
              if (rc.page !== index) return;
              var on = ch.id === st.focus;
              g.fillStyle = 'rgba(' + col + ',' + (on ? 0.36 : 0.18) + ')';
              g.strokeStyle = 'rgba(' + col + ',0.95)';
              g.lineWidth = on ? 3 : 1.2;
              g.fillRect((rc.x - 1) * x.scale, (rc.y - 1) * x.scale, (rc.w + 2) * x.scale, (rc.h + 2) * x.scale);
              g.strokeRect((rc.x - 1) * x.scale, (rc.y - 1) * x.scale, (rc.w + 2) * x.scale, (rc.h + 2) * x.scale);
            });
          });
          c.setAttribute('role', 'img');
          c.setAttribute('aria-label', label + ', page ' + (index + 1) + ', with the changes marked');
          f.appendChild(c);
        }
        f.appendChild(h('figcaption', null, esc(label)));
        return f;
      }
      if (st.mode === 'side' || !A || !B) {
        stage.className = 'po-vis po-vis-side';
        stage.appendChild(frame(A, 'a', pair[0], 'Old version'));
        stage.appendChild(frame(B, 'b', pair[1], 'New version'));
        if (st.mode !== 'side') stage.appendChild(note('This page exists in only one version, so it is shown side by side.'));
      } else if (st.mode === 'overlay' || st.mode === 'blink') {
        var box = h('div', 'po-overlay');
        var fa = frame(A, 'a', pair[0], 'Old version'), fb = frame(B, 'b', pair[1], 'New version');
        fb.classList.add('po-top');
        box.appendChild(fa); box.appendChild(fb);
        stage.appendChild(box);
        if (st.mode === 'overlay') {
          fb.style.opacity = 0.5;
          stage.appendChild(ui.slider('Show the new version', 0, 100, 1, 50, function (v) { return v + '%'; }, function (v) { fb.style.opacity = v / 100; }));
        } else {
          var on = true;
          st.blink = setInterval(function () { on = !on; fb.style.opacity = on ? 1 : 0; }, 750);
          stage.appendChild(note('Switching between the two versions. Anything that jumps has changed.'));
        }
      } else {
        var vd = O.visualDiff(A.canvas, B.canvas);
        var base = d.createElement('canvas');
        base.width = A.canvas.width; base.height = A.canvas.height;
        var g2 = base.getContext('2d');
        g2.fillStyle = '#fff'; g2.fillRect(0, 0, base.width, base.height);
        g2.globalAlpha = 0.3; g2.drawImage(B.canvas, 0, 0, base.width, base.height); g2.globalAlpha = 1;
        g2.drawImage(vd.heat, 0, 0);
        base.setAttribute('role', 'img');
        base.setAttribute('aria-label', 'Difference: red marks show where the pages differ');
        var f = h('figure', 'po-frame po-frame-wide');
        f.appendChild(base);
        f.appendChild(h('figcaption', null, esc(vd.ratio < 0.0005 ? 'These pages look the same' : 'Red marks where the pages differ (' + (vd.ratio * 100).toFixed(vd.ratio < 0.01 ? 2 : 1) + '% of the page)')));
        stage.appendChild(f);
      }
    }
    async function report() {
      var pr = runProgress('Making the report');
      try {
        var bytes = await O.compareReport(st.ba, st.bb, st.res);
        pr.end();
        download(pdfBlob(bytes), 'comparison-' + baseName(pickA.get().name) + '-' + baseName(pickB.get().name) + '.pdf');
      } catch (e) { pr.end(); failSay(e, 'Could not make the report'); }
    }
    return { destroy: function () { clearInterval(st.blink); try { if (st.pa) st.pa.destroy(); if (st.pb) st.pb.destroy(); } catch (e) {} st.cache = {}; } };
  };

  /* =====================================================================
     D15 — bundle builder
     ===================================================================== */

  RENDER.bundle = function (ctx) {
    var st = {
      items: [], cover: { on: true, title: '', subtitle: '', preparedFor: '', preparedBy: defaultName(), date: '', logo: null },
      toc: true, bookmarks: true, numbers: { on: true, position: 'bc', format: 'page-n-of-N', start: 1, skipCover: true, skipToc: true },
      header: '', footer: '', bates: { on: false, prefix: 'DOC-', start: 1, digits: 6 }, paper: 'a4', last: null
    };
    if (hasDoc()) st.items.push({ kind: 'pdf', name: openName(), title: baseName(openName()), open: true });
    var s1 = step(1, 'Files, in order', 'drag or use the arrows');
    var list = h('ol', 'po-items', '', { 'aria-label': 'Files in the pack' });
    s1.appendChild(list);
    var add = h('div', 'po-row-acts');
    add.appendChild(button('btn btn-sm', ic('plus') + '<span>Add PDFs or images</span>', function () {
      PS.pickFiles('.pdf,application/pdf,image/png,image/jpeg,image/webp', true).then(function (files) {
        files.forEach(function (f) { st.items.push({ kind: /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) ? 'pdf' : 'image', name: f.name, title: baseName(f.name), file: f }); });
        draw(); plan();
      });
    }, { 'data-po': 'bundle-add' }));
    add.appendChild(button('btn btn-sm btn-ghost', ic('divider') + '<span>Add a section</span>', function () { st.items.push({ kind: 'divider', title: 'Section ' + (st.items.filter(function (x) { return x.kind === 'divider'; }).length + 1) }); draw(); plan(); }));
    s1.appendChild(add);
    ctx.main.appendChild(s1);

    var s2 = step(2, 'Cover page');
    var coverBox = h('div', 'po-sub');
    s2.appendChild(ui.toggle('Add a cover page', st.cover.on, function (v) { st.cover.on = v; coverBox.hidden = !v; plan(); }));
    [['title', 'Title', 'Client pack'], ['subtitle', 'Subtitle', ''], ['preparedFor', 'Prepared for', ''], ['preparedBy', 'Prepared by', ''], ['date', 'Date', 'Today']].forEach(function (f) {
      var i = input(st.cover[f[0]], { placeholder: f[2], autocomplete: 'off', 'data-k': 'cover-' + f[0] });
      i.addEventListener('input', function () { st.cover[f[0]] = i.value; plan(); });
      coverBox.appendChild(field(f[1], i));
    });
    var logoRow = h('div', 'po-row-acts');
    var logoName = h('span', 'po-note', 'No logo');
    logoRow.appendChild(button('btn btn-sm btn-ghost', ic('image') + '<span>Add a logo</span>', function () {
      PS.pickFiles('image/png,image/jpeg', false).then(function (f) {
        if (!f[0]) return;
        f[0].arrayBuffer().then(function (b) { st.cover.logo = new Uint8Array(b); logoName.textContent = f[0].name; });
      });
    }));
    logoRow.appendChild(logoName);
    coverBox.appendChild(logoRow);
    s2.appendChild(coverBox);
    ctx.main.appendChild(s2);

    var s3 = step(3, 'Contents and bookmarks');
    s3.appendChild(ui.toggle('Contents page with clickable page numbers', st.toc, function (v) { st.toc = v; plan(); }));
    s3.appendChild(ui.toggle('Bookmarks for each file and section', st.bookmarks, function (v) { st.bookmarks = v; }, 'Each file keeps its own bookmarks inside'));
    ctx.main.appendChild(s3);

    var s4 = step(4, 'Page numbers');
    var numBox = h('div', 'po-sub');
    s4.appendChild(ui.toggle('Number the pages', st.numbers.on, function (v) { st.numbers.on = v; numBox.hidden = !v; plan(); }));
    numBox.appendChild(h('div', 'ps-label', 'Position'));
    numBox.appendChild(ui.posPicker(st.numbers.position, function (v) { st.numbers.position = v; }));
    var fmt = ui.selectEl([['page-n-of-N', 'Page 3 of 12'], ['page-n', 'Page 3'], ['n', '3'], ['n-of-N', '3 of 12'], ['n/N', '3 / 12'], ['-n-', '– 3 –']], st.numbers.format);
    fmt.addEventListener('change', function () { st.numbers.format = fmt.value; });
    numBox.appendChild(field('Format', fmt));
    var startIn = input(st.numbers.start, { type: 'number', min: '0', max: '99999', inputmode: 'numeric' });
    startIn.addEventListener('input', function () { st.numbers.start = Math.max(0, parseInt(startIn.value, 10) || 0); plan(); });
    numBox.appendChild(field('Start at', startIn));
    numBox.appendChild(ui.toggle('Skip the cover', st.numbers.skipCover, function (v) { st.numbers.skipCover = v; plan(); }));
    numBox.appendChild(ui.toggle('Skip the contents', st.numbers.skipToc, function (v) { st.numbers.skipToc = v; plan(); }));
    s4.appendChild(numBox);
    var hf = h('details', 'po-group');
    hf.appendChild(h('summary', null, '<span>Header, footer and Bates numbers</span><small>optional</small>'));
    var hIn = input('', { placeholder: 'e.g. {title} · Confidential', autocomplete: 'off' }), fIn = input('', { placeholder: 'e.g. {file}', autocomplete: 'off' });
    hIn.addEventListener('input', function () { st.header = hIn.value; });
    fIn.addEventListener('input', function () { st.footer = fIn.value; });
    hf.appendChild(field('Header (centre)', hIn, '{title}, {file}, {section}, {date}, {page} and {pages} are filled in for each page'));
    hf.appendChild(field('Footer (left)', fIn));
    var batesBox = h('div', 'po-sub po-grid');
    batesBox.hidden = true;
    hf.appendChild(ui.toggle('Bates numbers (bottom right)', st.bates.on, function (v) { st.bates.on = v; batesBox.hidden = !v; }));
    var bp = input(st.bates.prefix, { autocomplete: 'off', maxlength: '24' }), bs = input(st.bates.start, { type: 'number', min: '0', inputmode: 'numeric' }), bd = input(st.bates.digits, { type: 'number', min: '1', max: '12', inputmode: 'numeric' });
    bp.addEventListener('input', function () { st.bates.prefix = bp.value; });
    bs.addEventListener('input', function () { st.bates.start = Math.max(0, parseInt(bs.value, 10) || 0); });
    bd.addEventListener('input', function () { st.bates.digits = Math.min(12, Math.max(1, parseInt(bd.value, 10) || 6)); });
    batesBox.appendChild(field('Prefix', bp)); batesBox.appendChild(field('First number', bs)); batesBox.appendChild(field('Digits', bd));
    hf.appendChild(batesBox);
    hf.appendChild(h('div', 'ps-label', 'Paper for the cover, contents and image pages'));
    hf.appendChild(ui.seg([['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal']], st.paper, function (v) { st.paper = v; }));
    s4.appendChild(hf);
    ctx.main.appendChild(s4);

    var dragFrom = null;
    function draw() {
      list.innerHTML = '';
      if (!st.items.length) list.appendChild(h('li', 'po-note', 'Add the files that go in the pack.'));
      st.items.forEach(function (it, i) {
        var li = h('li', 'po-item k-' + it.kind, '', { draggable: 'true', 'data-i': String(i) });
        li.appendChild(h('span', 'po-grip', ic('grip')));
        li.appendChild(h('span', 'po-item-ic', ic(it.kind === 'divider' ? 'divider' : it.kind === 'image' ? 'image' : 'file')));
        var t = input(it.title, { 'aria-label': it.kind === 'divider' ? 'Section title' : 'Title in the contents for ' + it.name, autocomplete: 'off' });
        t.addEventListener('input', function () { it.title = t.value; plan(); });
        var mid = h('div', 'po-item-mid');
        mid.appendChild(t);
        mid.appendChild(h('small', 'po-item-meta', esc(meta(it))));
        li.appendChild(mid);
        var acts = h('span', 'po-item-acts');
        var up = button('ps-ib', ic('up'), function () { move(i, i - 1); }, { 'aria-label': 'Move up' });
        var dn = button('ps-ib', ic('down'), function () { move(i, i + 1); }, { 'aria-label': 'Move down' });
        up.disabled = i === 0; dn.disabled = i === st.items.length - 1;
        acts.appendChild(up); acts.appendChild(dn);
        acts.appendChild(button('ps-ib', ic('x'), function () { st.items.splice(i, 1); draw(); plan(); }, { 'aria-label': 'Remove ' + (it.title || it.name || 'item') }));
        li.appendChild(acts);
        li.addEventListener('dragstart', function (e) { if (e.target.closest && e.target.closest('input')) { e.preventDefault(); return; } dragFrom = i; li.classList.add('is-drag'); try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
        li.addEventListener('dragend', function () { li.classList.remove('is-drag'); dragFrom = null; });
        li.addEventListener('dragover', function (e) { if (dragFrom == null) return; e.preventDefault(); li.classList.add('is-over'); });
        li.addEventListener('dragleave', function () { li.classList.remove('is-over'); });
        li.addEventListener('drop', function (e) { if (dragFrom == null) return; e.preventDefault(); e.stopPropagation(); move(dragFrom, i); });
        list.appendChild(li);
      });
    }
    function meta(it) { return it.kind === 'divider' ? 'Section page' : (it.open ? 'Open in the studio' : it.name) + (it.pages ? ' · ' + plural(it.pages, 'page') : ''); }
    function move(from, to) {
      if (to < 0 || to >= st.items.length || from === to) return;
      st.items.splice(to, 0, st.items.splice(from, 1)[0]);
      draw(); plan();
    }
    async function bytesOf(it) {
      if (it.bytes) return it.bytes;
      if (it.open) it.bytes = await currentBytes();
      else if (it.file) it.bytes = new Uint8Array(await it.file.arrayBuffer());
      return it.bytes;
    }
    async function buildPlan() {
      var bs = [];
      for (var i = 0; i < st.items.length; i++) bs.push(st.items[i].kind === 'divider' ? null : await bytesOf(st.items[i]));
      return {
        items: st.items.map(function (it, k) { return it.kind === 'divider' ? { kind: 'divider', title: it.title || 'Section' } : { kind: it.kind, name: it.name, title: it.title, bytes: bs[k] }; }),
        cover: st.cover.on ? { title: st.cover.title || 'Document pack', subtitle: st.cover.subtitle, preparedFor: st.cover.preparedFor, preparedBy: st.cover.preparedBy, date: st.cover.date || 'today', logo: st.cover.logo } : null,
        toc: st.toc ? { title: 'Contents' } : false, bookmarks: st.bookmarks, paper: st.paper,
        numbering: st.numbers.on ? { position: st.numbers.position, format: st.numbers.format, start: st.numbers.start, skipCover: st.numbers.skipCover, skipToc: st.numbers.skipToc } : null,
        header: st.header ? { center: st.header } : null, footer: st.footer ? { left: st.footer } : null,
        bates: st.bates.on ? { prefix: st.bates.prefix, start: st.bates.start, digits: st.bates.digits, position: 'br' } : null,
        title: st.cover.title || 'Document pack'
      };
    }
    var planT = null;
    function plan() {
      clearTimeout(planT);
      go.disabled = !st.items.some(function (x) { return x.kind !== 'divider'; });
      planT = setTimeout(async function () {
        var p;
        try { p = await O.bundlePlan(await buildPlan()); } catch (e) { return; }
        st.items.forEach(function (it, i) { var r = p.rows[i]; if (r && it.kind !== 'divider') it.pages = r.count; });
        $$('.po-item-meta', list).forEach(function (m, i) { if (st.items[i]) m.textContent = meta(st.items[i]); });
        ctx.side.innerHTML = '';
        var box = h('div', 'po-plan');
        box.appendChild(h('div', 'po-plan-head', '<strong>' + esc(plural(p.total, 'page')) + '</strong><small>in the finished pack</small>'));
        var ol = h('ol', 'po-plan-list');
        if (p.cover) ol.appendChild(h('li', 'is-front', '<span>Cover</span><small>page 1</small>'));
        if (p.tocPages) ol.appendChild(h('li', 'is-front', '<span>Contents</span><small>' + esc(plural(p.tocPages, 'page')) + '</small>'));
        p.rows.forEach(function (r) {
          var li = h('li', r.kind === 'divider' ? 'is-section' : '', '<span></span><small></small>');
          $('span', li).textContent = r.title || 'Untitled';
          $('small', li).textContent = r.error ? r.error : r.from == null ? 'not numbered' : (r.from === r.to ? 'p. ' + r.from : 'pp. ' + r.from + '–' + r.to);
          ol.appendChild(li);
        });
        box.appendChild(ol);
        box.appendChild(note('These are the numbers printed on the pages and in the contents.'));
        ctx.side.appendChild(box);
      }, 150);
    }
    var openBtn = addSecondary(ctx, 'Open the pack in the studio', function () {
      if (!st.last) return;
      var f = new File([st.last.bytes], st.last.name, { type: 'application/pdf' });
      closeJob();
      PS.addFiles([f]);
    });
    openBtn.hidden = true;
    var go = setPrimary(ctx, 'Build the pack', async function () {
      var pr = runProgress('Building the pack');
      try {
        var bytes = await O.bundle(await buildPlan(), { onProgress: pr.onProgress, isCancelled: pr.isCancelled });
        pr.end();
        var name = (String(st.cover.title || 'pack').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'pack') + '.pdf';
        download(pdfBlob(bytes), name);
        ctx.msg.textContent = 'Pack built: ' + plural(bytes.report.pages, 'page') + (bytes.report.warnings.length ? '. ' + bytes.report.warnings[0] : '.');
        st.last = { bytes: bytes, name: name };
        openBtn.hidden = false;
      } catch (e) { pr.end(); failSay(e, 'Could not build the pack'); }
    }, true);
    draw(); plan();
    return { destroy: function () { clearTimeout(planT); } };
  };

  /* =====================================================================
     D16 — stamps and comment summary
     ===================================================================== */

  function armStamp(spec) {
    var c = O.stampCanvas(spec, 3);
    closeJob();
    PS.setTool('sign', { canvas: c, key: PS.uid('stamp'), name: 'Stamp: ' + O.stampSpec(spec).text, width: Math.round(c.stampWidth) });
    showHint((PS.isPhone() ? 'Tap' : 'Click') + ' where the stamp goes. Then move or resize it like any object.');
    if (PS.isPhone()) PS.setSheet('closed');
  }
  function stampEveryPage(spec, pos, onlyFirst) {
    var c = O.stampCanvas(spec, 3);
    var key = PS.uid('stamp');
    S.assets[key] = c;
    var w = c.stampWidth, hh = c.stampHeight, m = 28, n = 0;
    PS.commitPages(function () {
      S.pages.forEach(function (ref, i) {
        if (onlyFirst && i > 0) return;
        var size = PS.refSize(ref);
        var col = pos.charAt(1), row = pos.charAt(0);
        var x = col === 'l' ? m : col === 'r' ? size.w - m - w : (size.w - w) / 2;
        var y = row === 't' ? m : size.h - m - hh;
        ref.scene = ref.scene || { v: 1, width: size.w, height: size.h, layers: [] };
        ref.scene.layers = (ref.scene.layers || []).concat([{ id: PS.uid('l'), type: 'image', name: 'Stamp: ' + O.stampSpec(spec).text, src: key, x: Math.max(0, x), y: Math.max(0, y), w: w, h: hh, rotation: 0, opacity: 1, visible: true, crop: { x: 0, y: 0, w: 1, h: 1 } }]);
        n++;
      });
    }, 'Stamp every page');
    PS.remountAll();
    PS.markDirty();
    return n;
  }

  RENDER.stamps = function (ctx) {
    var st = { preset: 'approved', text: '', color: '', shape: 'rounded', name: defaultName(), date: true, time: false, pos: 'tr' };
    function spec() { return { preset: st.preset === 'custom' ? null : st.preset, text: st.preset === 'custom' ? (st.text || 'STAMP') : '', color: st.preset === 'custom' ? (st.color || '#1B7F54') : undefined, shape: st.preset === 'custom' ? st.shape : 'rounded', name: st.name, date: st.date, time: st.time }; }
    var s1 = step(1, 'Choose a stamp');
    var grid = h('div', 'po-stamps', '', { role: 'radiogroup', 'aria-label': 'Stamps' });
    O.stampPresets.concat([{ id: 'custom', text: 'YOUR OWN', color: '#5B3FD9' }]).forEach(function (p) {
      var b = button('po-stamp', '', function () { st.preset = p.id; mark(); custom.hidden = p.id !== 'custom'; preview(); }, { role: 'radio', 'data-p': p.id, 'aria-label': p.text.charAt(0) + p.text.slice(1).toLowerCase() });
      if (p.id === 'custom') b.innerHTML = '<span class="po-stamp-own">' + ic('edit') + '<span>Your own</span></span>';
      else { var c = O.stampCanvas({ preset: p.id, angle: 0 }, 2); c.setAttribute('aria-hidden', 'true'); b.appendChild(c); }
      grid.appendChild(b);
    });
    function mark() { $$('.po-stamp', grid).forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-p') === st.preset)); }); }
    s1.appendChild(grid);
    var custom = h('div', 'po-sub');
    custom.hidden = true;
    var tIn = input('', { maxlength: '40', placeholder: 'e.g. CHECKED BY HR', autocomplete: 'off' });
    tIn.addEventListener('input', function () { st.text = tIn.value; preview(); });
    custom.appendChild(field('Stamp text', tIn));
    custom.appendChild(h('div', 'ps-label', 'Colour'));
    custom.appendChild(ui.swatches([['#1B7F54', 'Green'], ['#1D4ED8', 'Blue'], ['#B42318', 'Red'], ['#5E5967', 'Grey'], ['#7457F0', 'Purple'], ['#B9832F', 'Gold'], ['#17131F', 'Ink']], '#1B7F54', function (c) { st.color = c; preview(); }, true, { title: 'Stamp colour' }));
    custom.appendChild(h('div', 'ps-label', 'Shape'));
    custom.appendChild(ui.seg([['rounded', 'Rounded'], ['box', 'Box'], ['oval', 'Oval'], ['plain', 'Text only']], st.shape, function (v) { st.shape = v; preview(); }));
    s1.appendChild(custom);
    ctx.main.appendChild(s1);

    var s2 = step(2, 'Name, date and time');
    var nIn = input(st.name, { autocomplete: 'off', maxlength: '60', placeholder: 'Your name (optional)' });
    nIn.addEventListener('input', function () { st.name = nIn.value; preview(); });
    s2.appendChild(field('Name on the stamp', nIn, O.details.list().length ? 'Filled in from your saved details' : ''));
    s2.appendChild(ui.toggle('Add today’s date', st.date, function (v) { st.date = v; preview(); }));
    s2.appendChild(ui.toggle('Add the time', st.time, function (v) { st.time = v; preview(); }));
    ctx.main.appendChild(s2);

    var s3 = step(3, 'Place it');
    if (!hasDoc()) s3.appendChild(note('Open a PDF in the studio to stamp it.'));
    else {
      s3.appendChild(note('Place one stamp and move or resize it like any object, or put one on every page at once. Stamps become part of the page when you save.'));
      s3.appendChild(h('div', 'ps-label', 'Position on every page'));
      s3.appendChild(ui.posPicker(st.pos, function (v) { st.pos = v; }));
      var every = h('div', 'po-row-acts');
      every.appendChild(button('btn btn-sm', ic('stamp') + '<span>Stamp every page</span>', function () {
        var n = stampEveryPage(spec(), st.pos);
        closeJob();
        say('Stamp added to ' + plural(n, 'page') + '. Undo removes them all at once.');
      }, { 'data-po': 'stamp-every' }));
      s3.appendChild(every);
    }
    ctx.main.appendChild(s3);

    var s4 = step(4, 'Summary of comments');
    var sumBox = h('div', 'po-sub');
    s4.appendChild(sumBox);
    ctx.main.appendChild(s4);
    (async function () {
      if (!hasDoc()) { sumBox.appendChild(note('Open a PDF that has comments, notes or highlights.')); return; }
      sumBox.appendChild(note('Reading comments…'));
      var list = [];
      try { list = await O.comments(originalBytes()); } catch (e) { list = []; }
      sumBox.innerHTML = '';
      if (!list.length) { sumBox.appendChild(note('This document has no comments, notes or highlights from other PDF readers.')); return; }
      var people = {};
      list.forEach(function (c) { if (c.author) people[c.author] = 1; });
      sumBox.appendChild(note(plural(list.length, 'comment') + (Object.keys(people).length ? ' by ' + plural(Object.keys(people).length, 'person', 'people') : '') + '. The summary lists the page, author, date, the highlighted words and the comment, with a link back to each page.'));
      var ul = h('ul', 'po-comments');
      list.slice(0, 6).forEach(function (c) {
        var li = h('li', null, '<small></small><span></span>');
        $('small', li).textContent = 'Page ' + (c.page + 1) + ' · ' + c.type + (c.author ? ' · ' + c.author : '');
        $('span', li).textContent = c.text || (c.excerpt ? '“' + c.excerpt + '”' : '');
        ul.appendChild(li);
      });
      if (list.length > 6) ul.appendChild(h('li', 'po-note', esc('and ' + (list.length - 6) + ' more')));
      sumBox.appendChild(ul);
      var acts = h('div', 'po-row-acts');
      var name = baseName(openName());
      acts.appendChild(button('btn btn-sm', ic('download') + '<span>Document with the summary added</span>', function () {
        O.commentSummary(originalBytes(), { comments: list, mode: 'append', name: openName() }).then(function (b) { download(pdfBlob(b), name + '-with-comment-summary.pdf'); }).catch(function (e) { failSay(e); });
      }, { 'data-po': 'summary-append' }));
      acts.appendChild(button('btn btn-sm btn-ghost', 'Summary only (PDF)', function () {
        O.commentSummary(originalBytes(), { comments: list, mode: 'separate', name: openName() }).then(function (b) { download(pdfBlob(b), name + '-comment-summary.pdf'); }).catch(function (e) { failSay(e); });
      }));
      acts.appendChild(button('btn btn-sm btn-ghost', 'Spreadsheet (CSV)', function () { download(new Blob(['﻿' + O.commentsCsv(list)], { type: 'text/csv' }), name + '-comments.csv'); }));
      sumBox.appendChild(acts);
    })();

    var pv = h('div', 'po-stamp-preview');
    ctx.side.appendChild(pv);
    function preview() {
      pv.innerHTML = '';
      var c = O.stampCanvas(spec(), 2), sp = O.stampSpec(spec());
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Preview: ' + sp.text + (sp.sub ? ', ' + sp.sub : ''));
      pv.appendChild(c);
    }
    mark(); preview();
    setPrimary(ctx, hasDoc() ? 'Place on a page' : 'Open a PDF first', function () { armStamp(spec()); }, !hasDoc());
    return {};
  };

  /* =====================================================================
     D19 — saved workflows
     ===================================================================== */

  var PARAM_LABEL = { order: 'Order', title: 'Title', subtitle: 'Subtitle', preparedBy: 'Prepared by', preparedFor: 'Prepared for', date: 'Date (or “today”)', cover: 'Cover page', contents: 'Contents page', bookmarks: 'Bookmarks', paper: 'Paper', degrees: 'Turn by (degrees)', pages: 'Pages', position: 'Position', format: 'Format', start: 'Start at', skipFirst: 'Skip the first page', size: 'Text size', headerLeft: 'Header left', headerCenter: 'Header centre', headerRight: 'Header right', footerLeft: 'Footer left', footerCenter: 'Footer centre', footerRight: 'Footer right', prefix: 'Prefix', digits: 'Digits', text: 'Text', style: 'Style', opacity: 'Opacity (0.03–1)', color: 'Colour', preset: 'Kind', shape: 'Shape', name: 'Name', time: 'Add the time', author: 'Author', subject: 'Subject', allowPictures: 'Allow turning pages into pictures', metadata: 'Remove author, software and dates', attachments: 'Remove attached files', comments: 'Comments', forms: 'Form fields', links: 'Remove links', hiddenText: 'Remove hidden text', keepAttachments: 'Keep attached files', flatten: 'Flatten forms and comments', removeLinks: 'Remove links', compress: 'Make it smaller', printing: 'Printing', copying: 'Allow copying text', modifying: 'Allow changes' };
  function paramControl(spec, value, onChange, label) {
    var t = spec[0], c;
    if (t === 'bool') return ui.toggle(label, value, onChange);
    if (t === 'enum') {
      if (spec[1].length === 1) return null;
      c = ui.selectEl(spec[1].map(function (v) { return [String(v), String(v)]; }), String(value));
      c.addEventListener('change', function () { onChange(typeof spec[1][0] === 'number' ? Number(c.value) : c.value); });
    } else if (t === 'num' || t === 'int') {
      c = input(value, { type: 'number', min: String(spec[1]), max: String(spec[2]), step: t === 'int' ? '1' : 'any', inputmode: 'decimal' });
      c.addEventListener('input', function () { var v = Number(c.value); if (c.value !== '' && isFinite(v)) onChange(t === 'int' ? Math.round(v) : v); });
    } else if (t === 'color') {
      c = input(value || '#C62828', { type: 'color' });
      c.className = 'po-color';
      c.addEventListener('input', function () { onChange(c.value.toUpperCase()); });
    } else {
      c = input(value, { autocomplete: 'off', maxlength: String(spec[1] || 200), placeholder: t === 'range' ? 'all, odd, even, 1-3, last' : '' });
      c.addEventListener('input', function () { onChange(c.value); });
    }
    return field(label, c);
  }
  async function askPassword() {
    var wrap = h('div', 'ps-field');
    wrap.innerHTML = '<label for="po-wf-pw">Password to open the finished file</label><input class="input" id="po-wf-pw" type="password" autocomplete="new-password"><label for="po-wf-pw2" class="po-mt">Type it again</label><input class="input" id="po-wf-pw2" type="password" autocomplete="new-password"><p class="ps-note">Used for this run only. Workflows never store passwords.</p>';
    var ok = await PS.dialog({ title: 'Choose a password', body: wrap, ok: 'Run' });
    var a = $('#po-wf-pw', wrap).value, b = $('#po-wf-pw2', wrap).value;
    $('#po-wf-pw', wrap).value = ''; $('#po-wf-pw2', wrap).value = '';
    if (!ok) return null;
    if (!a || a !== b) { say(a ? 'The two passwords do not match' : 'No password given', 4200); return null; }
    return a;
  }
  RENDER.workflows = function (ctx) {
    var st = { wf: null, files: [], useOpen: hasDoc(), open: {} };
    var s1 = step(1, 'Pick a workflow');
    var lib = h('div', 'po-wf-lib');
    s1.appendChild(lib);
    var libActs = h('div', 'po-row-acts');
    libActs.appendChild(button('btn btn-sm btn-ghost', ic('plus') + '<span>New workflow</span>', function () { edit({ format: 'localeditor-pdf-workflow', version: '1.0', metadata: { name: 'My workflow' }, steps: [{ operation: 'page-numbers' }] }); }));
    libActs.appendChild(button('btn btn-sm btn-ghost', ic('upload') + '<span>Import</span>', function () {
      PS.pickFiles('.lepdfworkflow,.json,application/json', false).then(function (f) {
        if (!f[0]) return;
        if (f[0].size > 400000) { say('That file is too large to be a workflow', 4200); return; }
        f[0].text().then(function (t) {
          var v = O.validateWorkflow(t);
          if (!v.ok) { PS.dialog({ title: 'This workflow cannot be opened', text: v.errors[0], ok: 'OK', cancel: false }); return; }
          edit(v.workflow);
          ctx.msg.textContent = 'Imported “' + v.workflow.metadata.name + '”' + (v.warnings.length ? ' (' + plural(v.warnings.length, 'unused field') + ' left out)' : '') + '. Check the steps, then save it to keep it.';
        });
      });
    }, { 'data-po': 'wf-import' }));
    s1.appendChild(libActs);
    ctx.main.appendChild(s1);
    var s2 = step(2, 'Steps');
    ctx.main.appendChild(s2);
    var s3 = step(3, 'Run it');
    ctx.main.appendChild(s3);

    function drawLib() {
      lib.innerHTML = '';
      [['Built in', O.workflows.builtins()], ['Yours', O.workflows.saved()]].forEach(function (g) {
        if (!g[1].length) return;
        lib.appendChild(h('div', 'ps-label', esc(g[0])));
        g[1].forEach(function (w) {
          var b = button('po-wf', '<strong></strong><small></small>', function () { edit(w); }, { 'aria-pressed': String(!!(st.wf && st.wf.metadata.id === w.metadata.id)), 'data-wf': w.metadata.id });
          $('strong', b).textContent = w.metadata.name;
          $('small', b).textContent = w.steps.map(function (s) { return s.label; }).join(' → ');
          lib.appendChild(b);
        });
      });
    }
    function edit(w) {
      var v = O.validateWorkflow(w);
      st.wf = v.ok ? JSON.parse(JSON.stringify(v.workflow)) : w;
      st.open = {};
      drawLib(); drawSteps(); drawRun();
    }
    function drawSteps() {
      var title = $('.po-step-title', s2);
      s2.innerHTML = '';
      s2.appendChild(title);
      var w = st.wf;
      if (!w) { s2.appendChild(note('Pick a workflow above, or make a new one.')); return; }
      if (w.metadata.description) s2.appendChild(note(w.metadata.description));
      var nameIn = input(w.metadata.name, { maxlength: '80', autocomplete: 'off' });
      nameIn.addEventListener('input', function () { w.metadata.name = nameIn.value; });
      var ops = O.workflows.operations();
      var ol = h('ol', 'po-wf-steps');
      w.steps.forEach(function (s, i) {
        var op = ops.filter(function (o) { return o.id === s.operation; })[0];
        var li = h('li', 'po-wf-step' + (s.enabled ? '' : ' is-off'));
        var head = h('div', 'po-wf-head');
        var on = ui.inputEl('checkbox', null, { 'aria-label': 'Run this step: ' + s.label });
        on.checked = s.enabled;
        on.addEventListener('change', function () { s.enabled = on.checked; li.classList.toggle('is-off', !on.checked); });
        head.appendChild(on);
        var tb = button('po-wf-title', '<span class="po-step-n">' + (i + 1) + '</span><span class="po-wf-label"></span>' + ic(st.open[i] ? 'down' : 'chevron'), function () { st.open[i] = !st.open[i]; drawSteps(); }, { 'aria-expanded': String(!!st.open[i]) });
        $('.po-wf-label', tb).textContent = s.label;
        head.appendChild(tb);
        var acts = h('span', 'po-item-acts');
        var up = button('ps-ib', ic('up'), function () { w.steps.splice(i - 1, 0, w.steps.splice(i, 1)[0]); st.open = {}; drawSteps(); }, { 'aria-label': 'Move step up' });
        var dn = button('ps-ib', ic('down'), function () { w.steps.splice(i + 1, 0, w.steps.splice(i, 1)[0]); st.open = {}; drawSteps(); }, { 'aria-label': 'Move step down' });
        up.disabled = i === 0; dn.disabled = i === w.steps.length - 1;
        acts.appendChild(up); acts.appendChild(dn);
        acts.appendChild(button('ps-ib', ic('x'), function () { w.steps.splice(i, 1); st.open = {}; drawSteps(); }, { 'aria-label': 'Remove step' }));
        head.appendChild(acts);
        li.appendChild(head);
        if (st.open[i] && op) {
          var body = h('div', 'po-wf-body');
          if (op.about) body.appendChild(note(op.about));
          Object.keys(op.params).forEach(function (k) {
            var ctl = paramControl(op.params[k], s.parameters[k], function (v) { s.parameters[k] = v; }, PARAM_LABEL[k] || k);
            if (ctl) body.appendChild(ctl);
          });
          if (s.operation === 'protect') body.appendChild(note('You are asked for a password each time this runs. It is never saved in the workflow.', 'po-ok'));
          li.appendChild(body);
        }
        ol.appendChild(li);
      });
      s2.appendChild(ol);
      var addSel = ui.selectEl([['', 'Add a step…']].concat(ops.map(function (o) { return [o.id, o.label]; })), '');
      addSel.setAttribute('aria-label', 'Add a step');
      addSel.addEventListener('change', function () {
        if (!addSel.value) return;
        var v = O.validateWorkflow({ format: 'localeditor-pdf-workflow', version: '1.0', steps: [{ operation: addSel.value, parameters: addSel.value === 'delete-pages' || addSel.value === 'keep-pages' ? { pages: '1' } : {} }] });
        if (v.ok) { w.steps.push(v.workflow.steps[0]); st.open = {}; st.open[w.steps.length - 1] = true; }
        drawSteps();
      });
      s2.appendChild(addSel);
      var more = h('details', 'po-group');
      more.appendChild(h('summary', null, '<span>Name and file</span><small>save, export, share</small>'));
      more.appendChild(field('Name', nameIn));
      var file = h('div', 'po-row-acts');
      file.appendChild(button('btn btn-sm', ic('check') + '<span>Save</span>', function () {
        try { st.wf = JSON.parse(JSON.stringify(O.workflows.save(w))); drawLib(); say('Workflow saved on this device'); } catch (e) { say(e.message, 4200); }
      }, { 'data-po': 'wf-save' }));
      file.appendChild(button('btn btn-sm btn-ghost', ic('download') + '<span>Export</span>', function () {
        try {
          var text = O.workflows.serialize(w);
          var name = (O.validateWorkflow(w).workflow.metadata.id || 'workflow') + O.workflows.extension;
          var blob = new Blob([text], { type: 'application/json' });
          var fl = global.File ? new File([blob], name, { type: 'application/json' }) : null;
          if (fl && PS.isPhone() && navigator.canShare && navigator.canShare({ files: [fl] })) navigator.share({ files: [fl], title: w.metadata.name }).catch(function () {});
          else download(blob, name);
        } catch (e) { say(e.message, 4200); }
      }, { 'data-po': 'wf-export' }));
      var vid = O.validateWorkflow(w);
      if (vid.ok && O.workflows.saved().some(function (x) { return x.metadata.id === vid.workflow.metadata.id; })) file.appendChild(button('btn btn-sm btn-ghost po-danger', ic('trash') + '<span>Delete</span>', function () { O.workflows.remove(vid.workflow.metadata.id); st.wf = null; drawLib(); drawSteps(); drawRun(); }));
      more.appendChild(file);
      s2.appendChild(more);
    }
    function drawRun() {
      var title = $('.po-step-title', s3);
      s3.innerHTML = '';
      s3.appendChild(title);
      var list = h('ul', 'po-files');
      s3.appendChild(list);
      var acts = h('div', 'po-row-acts');
      acts.appendChild(button('btn btn-sm', ic('plus') + '<span>Add PDFs</span>', function () {
        PS.pickFiles('.pdf,application/pdf', true).then(function (fs) { fs.forEach(function (f) { st.files.push({ name: f.name, file: f }); }); files(); });
      }, { 'data-po': 'wf-add' }));
      var useOpen = button('btn btn-sm btn-ghost', ic('file') + '<span>Open document</span>', function () { st.useOpen = true; files(); });
      if (hasDoc()) acts.appendChild(useOpen);
      s3.appendChild(acts);
      s3.appendChild(note('Files run one by one unless a step combines them. Several results download as one zip.'));
      var run = setPrimary(ctx, 'Run', go, true);
      function files() {
        list.innerHTML = '';
        var all = (st.useOpen && hasDoc() ? [{ name: openName(), open: true }] : []).concat(st.files);
        all.forEach(function (f) {
          var li = h('li', 'po-file', '<span class="po-file-ic">' + ic('file') + '</span><span class="po-file-name"></span>');
          $('.po-file-name', li).textContent = f.name + (f.open ? ' (open in the studio)' : '');
          li.appendChild(button('ps-ib', ic('x'), function () { if (f.open) st.useOpen = false; else st.files.splice(st.files.indexOf(f), 1); files(); }, { 'aria-label': 'Remove ' + f.name }));
          list.appendChild(li);
        });
        if (!all.length) list.appendChild(h('li', 'po-note', 'Add the PDFs to run it on.'));
        useOpen.hidden = !hasDoc() || st.useOpen;
        run.disabled = !all.length || !st.wf;
        run.textContent = all.length > 1 ? 'Run on ' + plural(all.length, 'file') : 'Run';
      }
      files();
    }
    async function go() {
      var v = O.validateWorkflow(st.wf);
      if (!v.ok) { say(v.errors[0], 5000); return; }
      var pw = null;
      if (O.workflows.needsPassword(v.workflow)) { pw = await askPassword(); if (!pw) return; }
      var pr = runProgress('Running “' + v.workflow.metadata.name + '”');
      var log = null;
      try {
        var inputs = [];
        if (st.useOpen && hasDoc()) inputs.push({ name: openName(), bytes: await currentBytes() });
        for (var i = 0; i < st.files.length; i++) inputs.push({ name: st.files[i].name, bytes: new Uint8Array(await st.files[i].file.arrayBuffer()) });
        var out = await O.runWorkflow(inputs, v.workflow, { password: pw, onProgress: pr.onProgress, isCancelled: pr.isCancelled });
        pw = null;
        pr.end();
        if (out.files.length === 1) download(pdfBlob(out.files[0].bytes), out.files[0].name.replace(/\.pdf$/i, '') + '-' + v.workflow.metadata.id + '.pdf');
        else download(LE.zip(out.files.map(function (f) { return { name: f.name, data: f.bytes }; })), v.workflow.metadata.id + '.zip');
        log = out.log;
        ctx.msg.textContent = 'Done: ' + plural(out.files.length, 'file') + ' downloaded.';
      } catch (e) {
        pw = null;
        pr.end();
        failSay(e);
        log = e && e.log;
      }
      if (log) {
        ctx.side.innerHTML = '';
        var box = h('div', 'po-callout');
        box.appendChild(h('strong', null, 'What ran'));
        var ul = h('ul', 'po-log');
        log.forEach(function (l) { ul.appendChild(h('li', l.ok ? 'is-ok' : 'is-bad', ic(l.ok ? 'check' : 'alert') + '<span>' + esc(l.label + (l.detail ? ' · ' + l.detail : '')) + '</span>')); });
        box.appendChild(ul);
        ctx.side.appendChild(box);
      }
    }
    ctx.side.appendChild(sideCard('About workflows', ['A workflow is a small file that lists steps. It holds no documents and no passwords, and it never runs code.', 'Share it as a .lepdfworkflow file. Anyone can open it here and see every step before running it.']));
    drawLib();
    edit(O.workflows.builtins()[0]);
    return {};
  };

  /* =====================================================================
     D20 — fingerprint receipt
     ===================================================================== */

  RENDER.fingerprint = function (ctx) {
    var st = { fp: null, bytes: null };
    var s1 = step(1, 'Choose the file');
    var pick = filePick('File', { preferOpen: true, accept: '', chooseLabel: 'Choose any file' }, function (v) { if (v) compute(v); });
    s1.appendChild(pick);
    s1.appendChild(note('For the open document, the fingerprint is of the file exactly as you opened it, before any changes made here.'));
    ctx.main.appendChild(s1);
    var s2 = step(2, 'Fingerprint');
    s2.hidden = true;
    ctx.main.appendChild(s2);
    var go = setPrimary(ctx, 'Download receipt', receipt, true);
    ctx.side.appendChild(h('div', 'po-empty-side', ic('fingerprint') + '<p>A fingerprint is a 64-character code worked out from every byte of a file. Change one comma and it changes completely.</p>'));
    async function compute(v) {
      s2.hidden = false;
      var title = $('.po-step-title', s2);
      s2.innerHTML = ''; s2.appendChild(title);
      s2.appendChild(note('Working…'));
      try {
        st.bytes = await v.bytes();
        st.fp = await O.fingerprint(st.bytes, { name: v.open ? baseName(openName()) + '.pdf' : v.name });
      } catch (e) { failSay(e); return; }
      var fp = st.fp;
      s2.innerHTML = ''; s2.appendChild(title);
      var box = h('div', 'po-fp', '<div class="po-fp-short"></div><code class="po-fp-full"></code><dl class="po-fp-meta"></dl>');
      $('.po-fp-short', box).textContent = fp.short;
      $('.po-fp-full', box).textContent = fp.sha256.replace(/(.{16})/g, '$1 ').trim();
      var dl = $('dl', box);
      [['File', fp.name], ['Size', fmtBytes(fp.bytes)], ['Pages', fp.pages == null ? '—' : String(fp.pages)], ['Made', new Date(fp.at).toLocaleString()]].forEach(function (r) { var dt = h('dt'), dd = h('dd'); dt.textContent = r[0]; dd.textContent = r[1]; dl.appendChild(dt); dl.appendChild(dd); });
      s2.appendChild(box);
      var acts = h('div', 'po-row-acts');
      acts.appendChild(button('btn btn-sm', ic('copy') + '<span>Copy fingerprint</span>', function () { copy(fp.sha256, 'Fingerprint copied'); }));
      acts.appendChild(button('btn btn-sm btn-ghost', ic('copy') + '<span>Copy check link</span>', function () { copy(fp.url, 'Link copied'); }));
      acts.appendChild(button('btn btn-sm btn-ghost', ic('image') + '<span>Card picture</span>', function () {
        O.receiptCard(st.bytes, { fingerprint: fp }).then(function (b) { download(b, baseName(fp.name) + '-fingerprint.png'); }).catch(function (e) { failSay(e); });
      }, { 'data-po': 'fp-card' }));
      s2.appendChild(acts);
      var what = h('div', 'po-callout', '<strong>What this shows</strong><p></p><p></p>');
      $$('p', what)[0].textContent = O.proves;
      $$('p', what)[1].textContent = O.doesNotProve;
      s2.appendChild(what);
      var more = h('details', 'po-group');
      more.appendChild(h('summary', null, '<span>Put the receipt inside a copy</span><small>makes a changed copy</small>'));
      more.appendChild(note('These make a new copy, which has its own, different fingerprint. The receipt inside it describes the original file you chose above.'));
      var ma = h('div', 'po-row-acts');
      if (fp.pages != null) {
        ma.appendChild(button('btn btn-sm btn-ghost', 'Copy with the receipt as its last page', function () { O.appendReceipt(st.bytes, { fingerprint: fp }).then(function (b) { download(pdfBlob(b), baseName(fp.name) + '-with-receipt.pdf'); }).catch(function (e) { failSay(e); }); }));
        ma.appendChild(button('btn btn-sm btn-ghost', 'Copy with the fingerprint in its details', function () { O.embedFingerprint(st.bytes, { fingerprint: fp }).then(function (b) { download(pdfBlob(b), baseName(fp.name) + '-fingerprinted.pdf'); }).catch(function (e) { failSay(e); }); }));
      } else ma.appendChild(note('Only PDFs can carry a receipt inside.'));
      more.appendChild(ma);
      s2.appendChild(more);
      go.disabled = false;
      ctx.side.innerHTML = '';
      var qr = h('figure', 'po-qr');
      try {
        await O.loadQr();
        var m = O.qrMatrix(fp.url), n = m.length, cell = 6, c = d.createElement('canvas');
        c.width = c.height = (n + 8) * cell;
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#000';
        for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (m[r][k]) g.fillRect((k + 4) * cell, (r + 4) * cell, cell, cell);
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', 'QR code that opens the check page with this fingerprint');
        qr.appendChild(c);
      } catch (e) {}
      qr.appendChild(h('figcaption', null, 'Scan to check a copy. The fingerprint travels after the # in the link, which browsers never send to a server.'));
      ctx.side.appendChild(qr);
      var root = d.documentElement.getAttribute('data-root') || '../';
      var a = h('a', 'btn btn-sm btn-ghost po-verify-link', 'Open the check page', { href: root + 'verify/#sha256=' + fp.sha256, target: '_blank', rel: 'noopener' });
      ctx.side.appendChild(a);
    }
    async function receipt() {
      if (!st.fp) return;
      try { var b = await O.receiptPdf(st.bytes, { fingerprint: st.fp }); download(pdfBlob(b), baseName(st.fp.name) + '-receipt.pdf'); }
      catch (e) { failSay(e, 'Could not make the receipt'); }
    }
    return {};
  };

  PS.office = { open: openJob, close: closeJob, jobs: JOBS, armStamp: armStamp, stampEveryPage: stampEveryPage, armText: armText };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(addEntryPoints, 0); });
  else setTimeout(addEntryPoints, 0);
})(typeof window !== 'undefined' ? window : globalThis);
