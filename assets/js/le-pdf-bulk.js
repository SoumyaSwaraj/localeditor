/* LocalEditor: PDF studio bulk tools (protect, mail-merge, split by text, watermarks, compress). See docs/ROADMAP.md D5, D7, D8, D12, D13.
   Part 1 is LE.pdfBulk, pure byte-level functions that any page can reuse. Part 2 is the "Bulk & protect" area of the PDF studio.
   Everything runs on this device. Passwords are never logged, stored or written to any summary. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var d = global.document;

  /* =====================================================================
     Part 1 — LE.pdfBulk
     ===================================================================== */

  var MAX_ROWS = 2000;
  var MAX_PAGES = 2000;
  var MAX_IMAGE_PIXELS = 40e6;
  var CRYPT_SRC = 'assets/vendor/pdf-lib-crypt.min.js';
  var XLSX_SRC = 'assets/vendor/xlsx.full.min.js';

  function asset(path) {
    var root = '';
    try { root = d.documentElement.getAttribute('data-root') || ''; } catch (e) { root = ''; }
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root + path;
  }
  function PL() { return global.PDFLib; }
  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function safeKey(k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }

  function cancelledError() {
    var e = new Error('Cancelled');
    e.cancelled = true;
    return e;
  }
  /* opts.signal may be an AbortSignal or any { aborted } object; opts.isCancelled may be a function. */
  function checkCancel(opts) {
    if (!opts) return;
    if ((opts.signal && opts.signal.aborted) || (typeof opts.isCancelled === 'function' && opts.isCancelled())) throw cancelledError();
  }
  function progress(opts, done, total, label) {
    if (opts && typeof opts.onProgress === 'function') opts.onProgress(done, total, label);
  }

  function toBytes(input) {
    if (input == null) return Promise.reject(new Error('No PDF data'));
    if (input instanceof Uint8Array) return Promise.resolve(input);
    if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
    if (ArrayBuffer.isView(input)) return Promise.resolve(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    if (typeof Blob !== 'undefined' && input instanceof Blob) return input.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    if (input && input._bytes) return Promise.resolve(input._bytes);
    return Promise.reject(new Error('Expected a PDF file or bytes'));
  }
  function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }

  function ready() {
    if (LE.pdf && LE.pdf.ready) return LE.pdf.ready();
    return Promise.reject(new Error('PDF engine is not loaded'));
  }

  /* pdf.js, always with isEvalSupported: false (CVE-2024-4367). */
  function pdfjsOpen(bytes, password) {
    var params = { data: u8(bytes).slice(0), isEvalSupported: false };
    if (password != null) params.password = password;
    return global.pdfjsLib.getDocument(params).promise;
  }

  /* The encryption build of pdf-lib (@cantoo/pdf-lib, MIT) is loaded on first use under its own name so it never
     replaces the PDFLib global the rest of the studio uses. */
  var cryptPromise = null;
  function cryptLib() {
    if (LE.pdfBulk && LE.pdfBulk._crypt) return Promise.resolve(LE.pdfBulk._crypt);
    if (cryptPromise) return cryptPromise;
    cryptPromise = ready().then(function () {
      var prev = global.PDFLib;
      return LE.lazy(asset(CRYPT_SRC)).then(function () {
        var lib = global.PDFLib;
        global.PDFLib = prev;
        if (!lib || lib === prev || !lib.PDFDocument || typeof lib.PDFDocument.prototype.encrypt !== 'function') throw new Error('The encryption library failed to start');
        api._crypt = lib;
        return lib;
      }, function (err) { global.PDFLib = prev; throw err; });
    });
    cryptPromise.catch(function () { cryptPromise = null; });
    return cryptPromise;
  }

  function xlsxLib() {
    if (global.XLSX && global.XLSX.read) return Promise.resolve(global.XLSX);
    return LE.lazy(asset(XLSX_SRC)).then(function () {
      if (!global.XLSX || !global.XLSX.read) throw new Error('The spreadsheet reader failed to start');
      return global.XLSX;
    });
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    global.crypto.getRandomValues(b);
    return b;
  }
  function randomInt(max) {
    var lim = Math.floor(0x100000000 / max) * max;
    var x;
    do { x = global.crypto.getRandomValues(new Uint32Array(1))[0]; } while (x >= lim);
    return x % max;
  }

  /* ---------- names, tokens, CSV ---------- */

  var TOKEN_RE = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]+?)\s*)?\}\}/g;

  function normKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return isoDate(v);
    return String(v);
  }
  function isoDate(dt) {
    if (!(dt instanceof Date) || isNaN(dt)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }
  /* Reads YYYY-MM-DD, DD/MM/YYYY (or MM/DD/YYYY with order 'mdy'), DD.MM.YYYY, and 8-digit YYYYMMDD. */
  function parseDate(s, order) {
    s = String(s == null ? '' : s).trim();
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y > 30 ? 1900 : 2000;
      if (order === 'mdy' && a <= 12) return { y: y, m: a, d: b };
      if (a > 12 || order !== 'mdy') return { y: y, m: b, d: a };
      return { y: y, m: a, d: b };
    }
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    return null;
  }
  function applyFilter(value, filter, opts) {
    if (!filter) return value;
    var f = String(filter).trim();
    var low = f.toLowerCase();
    if (low === 'upper') return value.toUpperCase();
    if (low === 'lower') return value.toLowerCase();
    if (low === 'trim') return value.trim();
    var lm = /^(last|first)(\d+)$/.exec(low);
    if (lm) { var n = +lm[2]; return lm[1] === 'last' ? value.slice(-n) : value.slice(0, n); }
    if (/^[dmy\-\/. ]+$/i.test(f) && /y/i.test(f)) {
      var dt = parseDate(value, opts && opts.dateOrder);
      if (!dt) return value;
      function p(x) { return (x < 10 ? '0' : '') + x; }
      return f.replace(/YYYY|yyyy/g, String(dt.y)).replace(/YY|yy/g, p(dt.y % 100)).replace(/MM|mm/g, p(dt.m)).replace(/DD|dd/g, p(dt.d));
    }
    return value;
  }
  /* Replaces {{column}} and {{column|filter}} with row values. Unknown keys become '' and are listed in missing. */
  function fillText(template, row, opts) {
    opts = opts || {};
    var missing = [];
    var lookup = rowLookup(row);
    var out = String(template == null ? '' : template).replace(TOKEN_RE, function (all, key, filter) {
      var k = normKey(key);
      var v;
      if (opts.extra && own(opts.extra, key)) v = opts.extra[key];
      else if (opts.extra && k && own(opts.extra, k)) v = opts.extra[k];
      else if (opts.mapping && opts.mapping[key] != null && lookup.has(normKey(opts.mapping[key]))) v = lookup.get(normKey(opts.mapping[key]));
      else if (lookup.has(k)) v = lookup.get(k);
      else { missing.push(key); v = ''; }
      return applyFilter(cellText(v), filter, opts);
    });
    if (opts.missing) opts.missing.push.apply(opts.missing, missing);
    return out;
  }
  function rowLookup(row) {
    var m = new Map();
    Object.keys(row || {}).forEach(function (k) { if (!m.has(normKey(k))) m.set(normKey(k), row[k]); });
    return m;
  }
  function tokensIn(text) {
    var out = [];
    String(text || '').replace(TOKEN_RE, function (all, key) { if (out.indexOf(key) < 0) out.push(key); return all; });
    return out;
  }

  var RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  function sanitizeName(name, ext) {
    ext = ext == null ? '.pdf' : ext;
    var s = String(name == null ? '' : name).normalize ? String(name || '').normalize('NFC') : String(name || '');
    s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[\\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    if (ext && s.toLowerCase().slice(-ext.length) === ext.toLowerCase()) s = s.slice(0, -ext.length);
    s = s.replace(/^[.\s-]+|[.\s]+$/g, '');
    if (s.length > 120) s = s.slice(0, 120).trim();
    if (!s || RESERVED.test(s)) s = (s ? s + '-' : '') + 'file';
    return s + ext;
  }
  /* De-duplicates names case-insensitively: "a.pdf", "a (2).pdf", "a (3).pdf". Returns { names, duplicates }. */
  function uniqueNames(names) {
    var seen = Object.create(null);
    var dupes = [];
    var out = names.map(function (n, i) {
      var key = n.toLowerCase();
      if (!seen[key]) { seen[key] = 1; return n; }
      var dot = n.lastIndexOf('.');
      var base = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
      var k = seen[key] + 1, cand;
      do { cand = base + ' (' + k + ')' + ext; k++; } while (seen[cand.toLowerCase()]);
      seen[key] = k - 1;
      seen[cand.toLowerCase()] = 1;
      dupes.push({ index: i, name: n, renamed: cand });
      return cand;
    });
    return { names: out, duplicates: dupes };
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; /* stop spreadsheet formula injection */
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(header, rows) {
    return [header].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function sniffDelimiter(text) {
    var first = String(text).split(/\r?\n/).slice(0, 5).join('\n');
    var counts = { '\t': 0, ',': 0, ';': 0, '|': 0 };
    var q = false;
    for (var i = 0; i < first.length; i++) {
      var c = first.charAt(i);
      if (c === '"') q = !q;
      else if (!q && own(counts, c)) counts[c]++;
    }
    var best = ',', n = -1;
    Object.keys(counts).forEach(function (k) { if (counts[k] > n) { n = counts[k]; best = k; } });
    return n > 0 ? best : ',';
  }
  /* RFC 4180 CSV / TSV with quoted fields. Returns an array of string arrays. */
  function parseDelimited(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    delim = delim || sniffDelimiter(text);
    var rows = [], row = [], cell = '', i = 0, q = false, n = text.length;
    while (i < n) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"' && cell.trim() === '') { q = true; cell = ''; i++; continue; }
      if (c === delim) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(cell); cell = '';
        rows.push(row); row = [];
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        i++;
        if (rows.length > MAX_ROWS + 1) break;
        continue;
      }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function tableFromGrid(grid, warnings) {
    if (!grid.length) return { columns: [], rows: [], warnings: warnings.concat(['The data has no rows.']) };
    var header = grid[0].map(function (h, i) { h = String(h == null ? '' : h).trim(); return h || 'Column ' + (i + 1); });
    var seen = Object.create(null);
    header = header.map(function (h) {
      var k = h.toLowerCase();
      if (!seen[k]) { seen[k] = 1; return h; }
      seen[k]++;
      return h + ' ' + seen[k];
    });
    var body = grid.slice(1);
    if (body.length > MAX_ROWS) {
      warnings.push('Only the first ' + MAX_ROWS + ' rows are used.');
      body = body.slice(0, MAX_ROWS);
    }
    var rows = body.map(function (r) {
      var o = {};
      header.forEach(function (h, i) { if (safeKey(h)) o[h] = cellText(r[i]).trim(); });
      return o;
    });
    return { columns: header.filter(safeKey), rows: rows, warnings: warnings };
  }
  /* parseTable(File | Blob | string, { sheet, delimiter }) → { columns, rows, sheets, sheet, warnings } */
  async function parseTable(input, opts) {
    opts = opts || {};
    var name = (input && input.name) || '';
    if (typeof input === 'string') return Object.assign(tableFromGrid(parseDelimited(input, opts.delimiter), []), { sheets: [], sheet: '' });
    var isSheet = /\.(xlsx|xlsm|xls|ods)$/i.test(name) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/i.test((input && input.type) || '');
    if (!isSheet) {
      var text = await input.text();
      return Object.assign(tableFromGrid(parseDelimited(text, opts.delimiter || (/\.tsv$/i.test(name) ? '\t' : null)), []), { sheets: [], sheet: '' });
    }
    if (input.size > 25 * 1024 * 1024) throw new Error('This spreadsheet is larger than 25 MB.');
    var XLSX = await xlsxLib();
    var buf = new Uint8Array(await input.arrayBuffer());
    var wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true, sheetRows: MAX_ROWS + 1 });
    var sheets = wb.SheetNames.slice();
    var sheet = opts.sheet && sheets.indexOf(opts.sheet) >= 0 ? opts.sheet : sheets[0];
    var grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '', blankrows: false });
    grid = grid.map(function (r) {
      return r.map(function (v) {
        if (v instanceof Date) return isoDate(new Date(v.getTime() + 43200000)); /* SheetJS dates are local midnight; nudge to avoid DST edges */
        if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
        return v;
      });
    });
    var t = tableFromGrid(grid, []);
    t.sheets = sheets;
    t.sheet = sheet;
    return t;
  }

  /* ---------- passwords ---------- */

  var WORDS = ('able acid aged also area army away baby back ball band bank base bath bear beat bell belt best bike bird blue boat body bold bone book boot born boss bowl bread brick bride brush cake calm camp card care cart case cash cast cave chef chip city clay clip club coal coat code coin cold cook cool copy corn cost crab crew crop crow cube cups dark dawn deer desk dial dice dish dock doll door dove draw dream drum duck dust eagle earth east echo edge elbow ember empty fact fair farm fast fern field film fire fish flag flat fleet float flute foam fold folk food foot fork fort frog fruit fuel game gate gear gift glad glass globe glow goat gold golf good grape grass green grid gulf hair half hall hand harp hawk heat herb hero hill hive home honey hook horn horse hotel house iris iron island ivory jade jazz jelly jewel juice jump jungle kayak kept kettle king kite knee knot lake lamp land lane leaf lemon lens light lily lime lion list lobby lodge loft lotus lunar magic mango maple marble mask meadow melon metal milk mint mirror moon moss motor mouse music nest night noble north novel oasis ocean olive onion opera orbit otter oven owl paint palm panda paper park pearl pepper piano pilot pine pixel planet plum polar pond pony pool poppy prism pulse puzzle quartz quest quiet rabbit radar rain ranch raven reef ridge river road robin rocket roof rose ruby sail salt sand scarf seal seed shell ship shore silk silver sky slate snow sofa solar spark spice spoon spring star steam stone storm sugar summit sun swan table tiger timber toast tomato torch tower trail train tree tulip tundra turtle umbrella unit urban valley vapor velvet violet violin wagon walnut water wave whale wheat wind window winter wolf wood yacht yard yarn zebra zero zinc acorn amber anchor apple arrow atlas autumn badge bamboo banjo barn basil beach berry blaze bloom breeze bronze cabin cactus candle canyon cedar cherry cliff clover cobalt comet coral cotton crane crystal daisy delta denim desert dolphin dragon falcon feather fiddle flame forest fossil galaxy garden garlic ginger glacier granite harbor hazel helmet indigo jasmine koala ladder lagoon lantern laser legend lizard magnet mammoth meteor mocha nectar nickel nutmeg oyster paddle parrot peach pebble pickle pillow plaza pocket quill radish raft ribbon saddle saffron shadow sierra spruce squid tango thistle thunder topaz tunnel vortex walrus willow').split(' ');

  /* A passphrase of random words from crypto.getRandomValues, e.g. "maple-orbit-quill-river-amber-cedar". */
  function passphrase(opts) {
    opts = opts || {};
    var n = clamp(Math.round(num(opts.words, 6)), 4, 10);
    var w = [];
    for (var i = 0; i < n; i++) w.push(WORDS[randomInt(WORDS.length)]);
    return w.join(opts.separator == null ? '-' : opts.separator);
  }
  function randomPassword(len) {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var s = '';
    for (var i = 0; i < (len || 24); i++) s += a.charAt(randomInt(a.length));
    return s;
  }
  /* A plain-language strength hint. bits is a rough guess; it is a hint, not a guarantee. */
  function strength(pw) {
    pw = String(pw || '');
    var hints = [];
    if (!pw) return { score: 0, bits: 0, label: 'No password', hints: ['Type a password or use a suggested passphrase.'] };
    var lower = pw.toLowerCase();
    var words = lower.split(/[^a-z]+/).filter(function (x) { return x.length >= 3; });
    var dictWords = words.filter(function (x) { return WORDS.indexOf(x) >= 0; });
    var pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    var bits = pw.length * Math.log2(Math.max(pool, 2));
    var covered = dictWords.reduce(function (a, w) { return a + w.length; }, 0);
    var letters = (lower.match(/[a-z]/g) || []).length;
    if (dictWords.length && covered >= letters * 0.7) {
      /* mostly common words: count words, not characters */
      bits = Math.min(bits, dictWords.length * Math.log2(WORDS.length) + (pw.length - covered - (dictWords.length - 1)) * 3 + (letters - covered) * 4.7);
    }
    if (/^(.)\1+$/.test(pw)) { bits = 4; hints.push('Repeating one character is easy to guess.'); }
    if (/^\d+$/.test(pw)) { bits = Math.min(bits, pw.length * 3.32); hints.push('Only digits: easy to try every combination.'); }
    if (/^\d{6,8}$/.test(pw) || parseDate(pw)) { bits = Math.min(bits, 16); hints.push('Dates (like a date of birth) are easy to guess for anyone who knows the person.'); }
    if (/^(password|passw0rd|qwerty|letmein|welcome|admin|123456|111111|abc123|iloveyou)/i.test(pw)) { bits = Math.min(bits, 10); hints.push('This is one of the most common passwords.'); }
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) bits -= 8;
    bits = Math.max(0, Math.round(bits));
    var score = bits < 28 ? 0 : bits < 36 ? 1 : bits < 50 ? 2 : bits < 64 ? 3 : 4;
    if (pw.length < 8) hints.push('Use at least 12 characters, or four or more random words.');
    else if (score < 3 && !hints.length) hints.push('Longer is stronger. A few random words are easy to type and hard to guess.');
    var label = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score];
    return { score: score, bits: bits, label: label, hints: hints };
  }

  /* ---------- D5: protect and unlock ---------- */

  function passwordError(reason, name) {
    var e = new Error(reason === 'incorrect'
      ? 'That password did not open ' + (name ? '“' + name + '”' : 'this PDF') + '. Check Caps Lock and try again.'
      : (name ? '“' + name + '”' : 'This PDF') + ' is locked with a password.');
    e.code = 'password';
    e.reason = reason;
    return e;
  }

  /* Reads the /Encrypt dictionary without decrypting anything. */
  /* Finds the /Encrypt dictionary by reading the file's bytes (trailer or cross-reference stream), so encrypted
     object streams are never parsed and nothing is decrypted. */
  async function encryptionInfo(input) {
    var bytes = u8(await toBytes(input));
    var text = new TextDecoder('latin1').decode(bytes);
    var re = /\/Encrypt\s*(?:(\d+)\s+(\d+)\s+R|<<)/g, m, last = null;
    while ((m = re.exec(text))) last = { n: m[1], g: m[2], at: m.index, direct: !m[1] };
    if (!last || !/%PDF-/.test(text.slice(0, 1024))) return { encrypted: false };
    var from, to;
    if (last.direct) {
      from = text.indexOf('<<', last.at);
      var depth = 0, k = from;
      for (; k < text.length - 1; k++) {
        if (text.charAt(k) === '<' && text.charAt(k + 1) === '<') { depth++; k++; }
        else if (text.charAt(k) === '>' && text.charAt(k + 1) === '>') { depth--; k++; if (!depth) break; }
      }
      to = k + 1;
    } else {
      var objRe = new RegExp('(^|[^0-9])' + last.n + '\\s+' + last.g + '\\s+obj\\b', 'g'), om, found = -1;
      while ((om = objRe.exec(text))) found = om.index + om[1].length;
      if (found < 0) return { encrypted: true, filter: null, algorithm: 'unknown' };
      from = text.indexOf('<<', found);
      to = text.indexOf('endobj', from);
      if (to < 0) to = Math.min(text.length, from + 4096);
    }
    var dict = null;
    lexContent(bytes.subarray(from, to)).forEach(function (o) { o.args.forEach(function (a) { if (!dict && a.t === 'dict') dict = a.v; }); });
    if (!dict) {
      /* a dictionary at the very end of the slice has no operator after it; add one */
      var tmp = new Uint8Array(to - from + 4);
      tmp.set(bytes.subarray(from, to));
      tmp.set([32, 69, 78, 68], to - from);
      lexContent(tmp).forEach(function (o) { o.args.forEach(function (a) { if (!dict && a.t === 'dict') dict = a.v; }); });
    }
    if (!dict) return { encrypted: true, filter: null, algorithm: 'unknown' };
    function val(key) { var t = dict[key]; return t ? (t.t === 'num' ? t.v : t.t === 'name' ? t.v : null) : null; }
    var info = { encrypted: true, filter: val('Filter'), V: val('V'), R: val('R'), length: val('Length'), cfm: null, permissions: null };
    try {
      var cf = dict.CF && dict.CF.t === 'dict' ? dict.CF.v : null;
      var stmf = val('StmF');
      if (cf && stmf && cf[stmf] && cf[stmf].t === 'dict' && cf[stmf].v.CFM) info.cfm = cf[stmf].v.CFM.v;
    } catch (e) {}
    info.algorithm = info.V === 5 ? 'AES-256' : info.cfm === 'AESV2' ? 'AES-128' : info.V === 4 ? 'RC4-128' : info.V === 2 ? 'RC4-' + (info.length || 40) : info.V === 1 ? 'RC4-40' : 'unknown';
    var p = val('P');
    if (p != null) {
      p = p | 0;
      info.permissions = {
        printing: (p & 4) ? ((info.R >= 3 && !(p & 2048)) ? 'low' : 'high') : false,
        modifying: !!(p & 8), copying: !!(p & 16), annotating: !!(p & 32), fillingForms: !!(p & 256), assembly: !!(p & 1024)
      };
    }
    return info;
  }

  /* After decryption the old /Encrypt dictionary and the old cross-reference stream (which still names it) survive as
     unreferenced objects. Drop everything that is not reachable from the catalog or the info dictionary. */
  function cleanupDecrypted(doc, lib) {
    var ctx = doc.context;
    try { gcContext(ctx, lib); } catch (e) {}
  }
  function walkRefsIn(lib, obj, fn) {
    if (!obj) return;
    if (obj instanceof lib.PDFRef) { fn(obj); return; }
    if (obj instanceof lib.PDFDict) { obj.entries().forEach(function (kv) { walkRefsIn(lib, kv[1], fn); }); return; }
    if (obj instanceof lib.PDFArray) { for (var i = 0; i < obj.size(); i++) walkRefsIn(lib, obj.get(i), fn); return; }
    if (obj.dict instanceof lib.PDFDict) walkRefsIn(lib, obj.dict, fn);
  }
  function gcContext(ctx, lib) {
    var reach = new Set(), queue = [];
    function visit(r) { if (!reach.has(r.tag)) { reach.add(r.tag); queue.push(r); } }
    ['Root', 'Info'].forEach(function (k) { var v = ctx.trailerInfo[k]; if (v instanceof lib.PDFRef) visit(v); else walkRefsIn(lib, v, visit); });
    while (queue.length) { var r = queue.pop(); walkRefsIn(lib, ctx.lookup(r), visit); }
    var dropped = 0;
    ctx.enumerateIndirectObjects().forEach(function (pair) { if (!reach.has(pair[0].tag)) { ctx.delete(pair[0]); dropped++; } });
    return dropped;
  }

  /* protect(bytes, { userPassword, ownerPassword, permissions, algorithm }) → Uint8Array (AES-256, revision 6, by default).
     permissions: { printing: 'high' | 'low' | false, copying, modifying, annotating, fillingForms, assembly } (all allowed when omitted).
     If the input is already encrypted, pass opts.currentPassword. */
  async function protect(input, opts) {
    opts = opts || {};
    var user = opts.userPassword == null ? '' : String(opts.userPassword);
    if (!user) throw new Error('Choose a password to open the PDF.');
    var lib = await cryptLib();
    var bytes = await toBytes(input);
    var doc;
    try {
      doc = await lib.PDFDocument.load(u8(bytes).slice(0), opts.currentPassword != null ? { password: String(opts.currentPassword), updateMetadata: false } : { updateMetadata: false });
    } catch (e) {
      if (/password|encrypt/i.test(String(e && e.message))) throw passwordError(opts.currentPassword != null ? 'incorrect' : 'required', opts.name);
      throw new Error('This file could not be read as a PDF.');
    }
    if (opts.currentPassword != null) cleanupDecrypted(doc, lib);
    var perm = opts.permissions || {};
    var printing = perm.printing === undefined ? 'high' : perm.printing;
    var permissions = {
      printing: printing === 'low' || printing === 'lowResolution' ? 'lowResolution' : printing ? 'highResolution' : false,
      modifying: perm.modifying !== false,
      copying: perm.copying !== false,
      annotating: perm.annotating !== false,
      fillingForms: perm.fillingForms !== false,
      contentAccessibility: true,
      documentAssembly: perm.assembly !== false
    };
    var owner = opts.ownerPassword ? String(opts.ownerPassword) : randomPassword(32);
    doc.encrypt({ userPassword: user, ownerPassword: owner, permissions: permissions, algorithm: opts.algorithm === 'AES-128' ? 'AES-128' : 'AES-256' });
    var out = await doc.save({ useObjectStreams: true });
    user = owner = null;
    return u8(out);
  }

  /* unlock(bytes, password) → Uint8Array without encryption. Wrong password → Error with code 'password', reason 'incorrect'. */
  async function unlock(input, password, opts) {
    opts = opts || {};
    var lib = await cryptLib();
    var bytes = await toBytes(input);
    var info = await encryptionInfo(bytes);
    if (!info.encrypted) {
      var e0 = new Error((opts.name ? '“' + opts.name + '”' : 'This PDF') + ' has no password.');
      e0.code = 'not-encrypted';
      throw e0;
    }
    if (info.filter && info.filter !== 'Standard') throw new Error('This PDF uses a certificate or a custom security handler, which cannot be unlocked here.');
    /* Check the password with pdf.js first: it opens with the user password or the owner password, and nothing else. */
    try {
      var probe = await pdfjsOpen(bytes, password == null ? '' : String(password));
      probe.destroy();
    } catch (e) {
      if (e && e.name === 'PasswordException') throw passwordError('incorrect', opts.name);
      throw new Error('This PDF could not be read.');
    }
    var doc;
    try { doc = await lib.PDFDocument.load(u8(bytes).slice(0), { password: String(password == null ? '' : password), updateMetadata: false }); }
    catch (e) {
      if (/password/i.test(String(e && e.message))) throw passwordError('incorrect', opts.name);
      throw new Error('This PDF could not be decrypted: ' + (e && e.message ? e.message : e));
    }
    cleanupDecrypted(doc, lib);
    var out = u8(await doc.save({ useObjectStreams: true }));
    var after = await encryptionInfo(out);
    if (after.encrypted) throw new Error('The unlocked copy still looks encrypted. Nothing was saved.');
    return out;
  }

  /* ---------- content streams: a small, careful lexer ---------- */

  var WS = [0, 9, 10, 12, 13, 32];
  function isWs(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0; }
  function isDelim(c) { return c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37; }

  /* lex(bytes) → [{ op, args, s, e }]; args are tokens { t: 'num'|'name'|'str'|'arr'|'dict'|'bool'|'null', v }.
     Byte offsets let a caller replace single operators and keep everything else byte for byte. */
  function lexContent(b) {
    var ops = [], stack = [], args = [], i = 0, n = b.length, opStart = -1;
    function push(tok, start) {
      if (stack.length) stack[stack.length - 1].v.push(tok);
      else { if (opStart < 0) opStart = start; args.push(tok); }
    }
    while (i < n) {
      var c = b[i];
      if (isWs(c)) { i++; continue; }
      var start = i;
      if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
      if (c === 40) {
        var depth = 1, out = [];
        i++;
        while (i < n && depth > 0) {
          var ch = b[i];
          if (ch === 92) {
            var nx = b[i + 1];
            if (nx === 110) { out.push(10); i += 2; }
            else if (nx === 114) { out.push(13); i += 2; }
            else if (nx === 116) { out.push(9); i += 2; }
            else if (nx === 98) { out.push(8); i += 2; }
            else if (nx === 102) { out.push(12); i += 2; }
            else if (nx === 13) { i += b[i + 2] === 10 ? 3 : 2; }
            else if (nx === 10) { i += 2; }
            else if (nx >= 48 && nx <= 55) {
              var o = 0, k = 1;
              while (k <= 3 && b[i + k] >= 48 && b[i + k] <= 55) { o = o * 8 + (b[i + k] - 48); k++; }
              out.push(o & 255); i += k;
            } else if (nx !== undefined) { out.push(nx); i += 2; }
            else i++;
            continue;
          }
          if (ch === 40) depth++;
          else if (ch === 41) { depth--; if (!depth) { i++; break; } }
          out.push(ch); i++;
        }
        push({ t: 'str', v: new Uint8Array(out), s: start, e: i }, start);
        continue;
      }
      if (c === 60 && b[i + 1] === 60) { i += 2; stack.push({ t: 'dict', v: [], s: start }); continue; }
      if (c === 62 && b[i + 1] === 62) {
        i += 2;
        var dct = stack.pop();
        if (dct) { dct.e = i; var obj = {}; for (var q = 0; q + 1 < dct.v.length; q += 2) if (dct.v[q].t === 'name' && safeKey(dct.v[q].v)) obj[dct.v[q].v] = dct.v[q + 1]; push({ t: 'dict', v: obj, s: dct.s, e: i }, dct.s); }
        continue;
      }
      if (c === 60) {
        i++;
        var hex = [];
        while (i < n && b[i] !== 62) { var hc = b[i]; if (!isWs(hc)) hex.push(hc); i++; }
        i++;
        if (hex.length % 2) hex.push(48);
        var hb = new Uint8Array(hex.length / 2);
        for (var h = 0; h < hb.length; h++) hb[h] = parseInt(String.fromCharCode(hex[2 * h], hex[2 * h + 1]), 16) || 0;
        push({ t: 'str', v: hb, hex: true, s: start, e: i }, start);
        continue;
      }
      if (c === 91) { i++; stack.push({ t: 'arr', v: [], s: start }); continue; }
      if (c === 93) { i++; var arr = stack.pop(); if (arr) { arr.e = i; push(arr, arr.s); } continue; }
      if (c === 47) {
        i++;
        var nm = '';
        while (i < n && !isWs(b[i]) && !isDelim(b[i])) {
          if (b[i] === 35 && i + 2 < n) { nm += String.fromCharCode(parseInt(String.fromCharCode(b[i + 1], b[i + 2]), 16) || 0); i += 3; }
          else { nm += String.fromCharCode(b[i]); i++; }
        }
        push({ t: 'name', v: nm }, start);
        continue;
      }
      if (c === 123 || c === 125) { i++; continue; }
      /* a number or an operator */
      var w = '';
      while (i < n && !isWs(b[i]) && !isDelim(b[i])) { w += String.fromCharCode(b[i]); i++; }
      if (!w) { i++; continue; }
      if (/^[+\-]?(\d+\.?\d*|\.\d+)$/.test(w)) { push({ t: 'num', v: parseFloat(w) }, start); continue; }
      if (w === 'true' || w === 'false') { push({ t: 'bool', v: w === 'true' }, start); continue; }
      if (w === 'null') { push({ t: 'null', v: null }, start); continue; }
      if (stack.length) { stack.length = 0; }
      if (w === 'BI') {
        /* inline image: skip the dictionary and binary data up to a whitespace-delimited EI */
        var j = i;
        while (j < n - 1 && !(b[j] === 73 && b[j + 1] === 68 && isWs(b[j - 1]) && (isWs(b[j + 2]) || j + 2 >= n))) j++;
        j += 3;
        while (j < n - 1 && !(isWs(b[j - 1]) && b[j] === 69 && b[j + 1] === 73 && (j + 2 >= n || isWs(b[j + 2]) || isDelim(b[j + 2])))) j++;
        i = Math.min(n, j + 2);
        ops.push({ op: 'BI', args: [], s: opStart < 0 ? start : opStart, e: i });
        args = []; opStart = -1;
        continue;
      }
      ops.push({ op: w, args: args, s: opStart < 0 ? start : opStart, e: i });
      args = []; opStart = -1;
    }
    return ops;
  }

  function mul(m, n) { /* m × n, PDF matrices [a b c d e f] */
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  }
  function nums(args) { return args.map(function (a) { return a.t === 'num' ? a.v : 0; }); }

  function streamBytes(stream) {
    var lib = PL();
    if (!stream) return new Uint8Array(0);
    if (stream instanceof lib.PDFRawStream) {
      try { return lib.decodePDFRawStream(stream).decode(); } catch (e) { return null; }
    }
    if (stream.getContents) return stream.getContents();
    if (stream.getUnencodedContents) return stream.getUnencodedContents();
    return null;
  }
  function pageContentBytes(page) {
    var lib = PL();
    var node = page.node;
    var contents = node.get(lib.PDFName.of('Contents'));
    var ctx = page.doc.context;
    var list = [];
    var c = ctx.lookup(contents);
    if (c instanceof lib.PDFArray) for (var i = 0; i < c.size(); i++) list.push(ctx.lookup(c.get(i)));
    else if (c) list.push(c);
    var parts = [], total = 0;
    for (var j = 0; j < list.length; j++) {
      var b = streamBytes(list[j]);
      if (!b) return null;
      parts.push(b, new Uint8Array([10]));
      total += b.length + 1;
    }
    var out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function setPageContent(page, bytes) {
    var lib = PL();
    var ctx = page.doc.context;
    var stream = ctx.flateStream(bytes);
    page.node.set(lib.PDFName.of('Contents'), ctx.register(stream));
  }

  /* ---------- fonts: decode shown strings to Unicode and measure them ---------- */

  var WIN_HIGH = { 128: 0x20AC, 130: 0x201A, 131: 0x192, 132: 0x201E, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x2C6, 137: 0x2030, 138: 0x160, 139: 0x2039, 140: 0x152, 142: 0x17D, 145: 0x2018, 146: 0x2019, 147: 0x201C, 148: 0x201D, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x2DC, 153: 0x2122, 154: 0x161, 155: 0x203A, 156: 0x153, 158: 0x17E, 159: 0x178 };
  var GLYPH = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', endash: '–', emdash: '—' };
  function glyphChar(name) {
    if (!name) return '';
    if (name.length === 1) return name;
    if (GLYPH[name]) return GLYPH[name];
    var m = /^uni([0-9A-F]{4})$/i.exec(name);
    if (m) return String.fromCharCode(parseInt(m[1], 16));
    return '';
  }
  function hexToStr(hex) {
    var s = '';
    for (var i = 0; i + 3 < hex.length + 1; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16) || 0);
    return s;
  }
  function parseToUnicode(bytes) {
    var text = '';
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    var map = new Map();
    var codeLen = 1;
    var cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
    if (cs) { var mm = /<([0-9A-Fa-f]+)>/.exec(cs[1]); if (mm) codeLen = Math.max(1, mm[1].length / 2); }
    var re = /beginbfchar([\s\S]*?)endbfchar/g, m;
    while ((m = re.exec(text))) {
      var pr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g, p;
      while ((p = pr.exec(m[1]))) map.set(parseInt(p[1], 16), hexToStr(p[2]));
    }
    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = re.exec(text))) {
      var rr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]*)>|\[([^\]]*)\])/g, r;
      while ((r = rr.exec(m[1]))) {
        var lo = parseInt(r[1], 16), hi = parseInt(r[2], 16);
        if (hi - lo > 65535) continue;
        if (r[4] != null) {
          var base = r[4];
          var last = parseInt(base.slice(-4), 16) || 0;
          var head = hexToStr(base.slice(0, -4));
          for (var c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + (c - lo)));
        } else {
          var items = (r[5] || '').match(/<([0-9A-Fa-f]*)>/g) || [];
          for (var k = 0; k < items.length && lo + k <= hi; k++) map.set(lo + k, hexToStr(items[k].slice(1, -1)));
        }
      }
    }
    return { map: map, codeLen: codeLen };
  }

  var STD_NAMES = {
    Helvetica: 'Helvetica', 'Helvetica-Bold': 'HelveticaBold', 'Helvetica-Oblique': 'HelveticaOblique', 'Helvetica-BoldOblique': 'HelveticaBoldOblique',
    'Times-Roman': 'TimesRoman', 'Times-Bold': 'TimesRomanBold', 'Times-Italic': 'TimesRomanItalic', 'Times-BoldItalic': 'TimesRomanBoldItalic',
    Courier: 'Courier', 'Courier-Bold': 'CourierBold', 'Courier-Oblique': 'CourierOblique', 'Courier-BoldOblique': 'CourierBoldOblique',
    Arial: 'Helvetica', 'Arial,Bold': 'HelveticaBold', 'Arial-BoldMT': 'HelveticaBold', ArialMT: 'Helvetica', TimesNewRoman: 'TimesRoman', 'TimesNewRomanPSMT': 'TimesRoman'
  };
  function fontStyle(baseName) {
    var b = String(baseName || '').replace(/^[A-Z]{6}\+/, '');
    var low = b.toLowerCase();
    return {
      base: b,
      bold: /bold|black|heavy|semibold|demi/.test(low),
      italic: /italic|oblique/.test(low),
      family: /courier|mono|consol|menlo/.test(low) ? 'mono' : /times|serif|georgia|garamond|roman|cambria|minion|book antiqua|palatino/.test(low) && !/sans/.test(low) ? 'serif' : 'sans'
    };
  }

  function makeFontReader(doc, fontDict, stdCache) {
    var lib = PL(), N = lib.PDFName, ctx = doc.context;
    function get(dict, k) { return dict ? dict.lookup(N.of(k)) : null; }
    function nameOf(o) { return o && o.encodedName ? o.encodedName.replace(/^\//, '').replace(/#([0-9A-Fa-f]{2})/g, function (a, h) { return String.fromCharCode(parseInt(h, 16)); }) : ''; }
    var subtype = nameOf(get(fontDict, 'Subtype'));
    var baseFont = nameOf(get(fontDict, 'BaseFont'));
    var R = { type0: subtype === 'Type0', codeLen: 1, toUni: null, style: fontStyle(baseFont), widths: null, dw: 1000, std: null, ok: true, type3: subtype === 'Type3' };
    var tu = get(fontDict, 'ToUnicode');
    if (tu) { var tb = streamBytes(tu); if (tb) { var parsed = parseToUnicode(tb); R.toUni = parsed.map; if (R.type0) R.codeLen = parsed.codeLen || 2; } }
    if (R.type0) {
      R.codeLen = 2;
      var enc = get(fontDict, 'Encoding');
      if (enc && !/^Identity-[HV]$/.test(nameOf(enc))) R.ok = !!R.toUni;
      var df = get(fontDict, 'DescendantFonts');
      var desc = df && df.get ? ctx.lookup(df.get(0)) : null;
      if (desc) {
        var dw = get(desc, 'DW');
        if (dw && dw.asNumber) R.dw = dw.asNumber();
        var W = get(desc, 'W');
        if (W && W.size) {
          R.widths = new Map();
          var i = 0;
          while (i < W.size()) {
            var first = ctx.lookup(W.get(i));
            var second = ctx.lookup(W.get(i + 1));
            if (second instanceof lib.PDFArray) {
              for (var k = 0; k < second.size(); k++) { var wv = ctx.lookup(second.get(k)); R.widths.set(first.asNumber() + k, wv && wv.asNumber ? wv.asNumber() : R.dw); }
              i += 2;
            } else {
              var last = second ? second.asNumber() : 0;
              var w3 = ctx.lookup(W.get(i + 2));
              for (var c = first.asNumber(); c <= last && c - first.asNumber() < 65536; c++) R.widths.set(c, w3 ? w3.asNumber() : R.dw);
              i += 3;
            }
          }
        }
      }
      if (!R.toUni) R.ok = false;
    } else {
      var fc = get(fontDict, 'FirstChar');
      var ws = get(fontDict, 'Widths');
      if (ws && ws.size) {
        R.widths = new Map();
        var f0 = fc && fc.asNumber ? fc.asNumber() : 0;
        for (var j = 0; j < ws.size(); j++) { var x = ctx.lookup(ws.get(j)); R.widths.set(f0 + j, x && x.asNumber ? x.asNumber() : 0); }
        var fd = get(fontDict, 'FontDescriptor');
        var mw = fd ? get(fd, 'MissingWidth') : null;
        R.dw = mw && mw.asNumber ? mw.asNumber() : 0;
      } else {
        var std = STD_NAMES[R.style.base] || STD_NAMES[baseFont];
        if (std) R.std = std;
      }
      R.diff = null;
      var en = get(fontDict, 'Encoding');
      if (en instanceof lib.PDFDict) {
        var diffs = get(en, 'Differences');
        if (diffs && diffs.size) {
          R.diff = new Map();
          var code = 0;
          for (var q = 0; q < diffs.size(); q++) {
            var it = ctx.lookup(diffs.get(q));
            if (it && it.asNumber) code = it.asNumber();
            else if (it && it.encodedName) { R.diff.set(code, glyphChar(nameOf(it))); code++; }
          }
        }
      }
      if (R.type3) R.ok = !!R.toUni;
    }
    R.decode = function (bytes) {
      var s = '', codes = [];
      var step = R.codeLen;
      for (var i = 0; i + step <= bytes.length; i += step) {
        var code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
        codes.push(code);
        var ch;
        if (R.toUni && R.toUni.has(code)) ch = R.toUni.get(code);
        else if (R.diff && R.diff.has(code)) ch = R.diff.get(code);
        else if (!R.type0) ch = code >= 128 && code < 160 ? (WIN_HIGH[code] ? String.fromCharCode(WIN_HIGH[code]) : '') : String.fromCharCode(code);
        else ch = '';
        s += ch;
      }
      return { text: s, codes: codes };
    };
    R.width = function (codes) {
      var total = 0;
      if (R.widths) { codes.forEach(function (c) { total += R.widths.has(c) ? R.widths.get(c) : R.dw; }); return total; }
      if (R.std) {
        var f = stdCache[R.std];
        if (f) {
          var txt = codes.map(function (c) { return c >= 128 && c < 160 && WIN_HIGH[c] ? String.fromCharCode(WIN_HIGH[c]) : String.fromCharCode(c); }).join('');
          try { return f.widthOfTextAtSize(txt, 1000); } catch (e) { return codes.length * 500; }
        }
      }
      return codes.length * (R.type0 ? 1000 : 500);
    };
    return R;
  }

  async function stdFontsFor(doc) {
    var lib = PL();
    var cache = {};
    var names = ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique', 'TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic', 'Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'];
    for (var i = 0; i < names.length; i++) cache[names[i]] = await doc.embedFont(lib.StandardFonts[names[i]]);
    return cache;
  }

  /* Walks one page's content with a small text state machine. Returns the text-showing operators with their decoded
     text, user-space origin, size, font style and fill colour, plus image placements (Do) for compression. */
  function walkPage(page, contentBytes, opts) {
    opts = opts || {};
    var lib = PL(), N = lib.PDFName, doc = page ? page.doc : opts.doc;
    var ops = lexContent(contentBytes);
    var res = opts.resources !== undefined ? opts.resources : page.node.Resources();
    var fonts = res ? res.lookup(N.of('Font')) : null;
    var xobjs = res ? res.lookup(N.of('XObject')) : null;
    var readers = {};
    function reader(name) {
      if (readers[name] !== undefined) return readers[name];
      var fd = fonts ? fonts.lookup(N.of(name)) : null;
      readers[name] = fd instanceof lib.PDFDict ? makeFontReader(doc, fd, opts.std || {}) : null;
      return readers[name];
    }
    var gs = { ctm: (opts.ctm || [1, 0, 0, 1, 0, 0]).slice(), fill: [0, 0, 0] };
    var gstack = [];
    var T = { tm: [1, 0, 0, 1, 0, 0], tlm: [1, 0, 0, 1, 0, 0], font: null, fname: '', size: 12, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
    var shows = [], images = [], btIndex = -1;
    function show(op, segs) {
      var R = T.font;
      var trm = mul([T.size * T.th, 0, 0, T.size, 0, T.rise], mul(T.tm, gs.ctm));
      var text = '', advance = 0, glyphs = 0, spaces = 0;
      segs.forEach(function (sg) {
        if (sg.t === 'num') { advance -= sg.v; return; }
        if (sg.t !== 'str') return;
        if (!R) { glyphs += sg.v.length; return; }
        var dec = R.decode(sg.v);
        text += dec.text;
        advance += R.width(dec.codes);
        glyphs += dec.codes.length;
        if (!R.type0) dec.codes.forEach(function (c) { if (c === 32) spaces++; });
      });
      var tx = (advance / 1000 * T.size + T.tc * glyphs + T.tw * spaces) * T.th;
      var item = {
        index: op.index, op: op.op, s: op.s, e: op.e, text: text, decodable: !!(R && R.ok),
        x: trm[4], y: trm[5], size: Math.hypot(trm[2], trm[3]) || T.size, angle: Math.atan2(trm[1], trm[0]) * 180 / Math.PI,
        width: tx * Math.hypot(mul(T.tm, gs.ctm)[0], mul(T.tm, gs.ctm)[1]), advance: advance, glyphs: glyphs, spaces: spaces,
        tc: T.tc, tw: T.tw, fontSize: T.size, style: R ? R.style : fontStyle(''), color: gs.fill.slice(), bt: btIndex
      };
      shows.push(item);
      T.tm = mul([1, 0, 0, 1, tx, 0], T.tm);
    }
    function setFill(arr) {
      if (arr.length === 1) gs.fill = [arr[0], arr[0], arr[0]];
      else if (arr.length === 3) gs.fill = arr.slice();
      else if (arr.length === 4) gs.fill = [(1 - arr[0]) * (1 - arr[3]), (1 - arr[1]) * (1 - arr[3]), (1 - arr[2]) * (1 - arr[3])];
    }
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      o.index = i;
      var a = o.args, v;
      switch (o.op) {
        case 'q': gstack.push({ ctm: gs.ctm.slice(), fill: gs.fill.slice() }); break;
        case 'Q': if (gstack.length) gs = gstack.pop(); break;
        case 'cm': v = nums(a); if (v.length === 6) gs.ctm = mul(v, gs.ctm); break;
        case 'BT': T.tm = [1, 0, 0, 1, 0, 0]; T.tlm = [1, 0, 0, 1, 0, 0]; btIndex++; break;
        case 'Tf': if (a.length >= 2) { T.fname = a[0].v; T.font = reader(a[0].v); T.size = a[1].v; } break;
        case 'Tc': T.tc = nums(a)[0] || 0; break;
        case 'Tw': T.tw = nums(a)[0] || 0; break;
        case 'Tz': T.th = (nums(a)[0] || 100) / 100; break;
        case 'TL': T.tl = nums(a)[0] || 0; break;
        case 'Ts': T.rise = nums(a)[0] || 0; break;
        case 'Td': v = nums(a); T.tlm = mul([1, 0, 0, 1, v[0] || 0, v[1] || 0], T.tlm); T.tm = T.tlm.slice(); break;
        case 'TD': v = nums(a); T.tl = -(v[1] || 0); T.tlm = mul([1, 0, 0, 1, v[0] || 0, v[1] || 0], T.tlm); T.tm = T.tlm.slice(); break;
        case 'Tm': v = nums(a); if (v.length === 6) { T.tlm = v; T.tm = v.slice(); } break;
        case 'T*': T.tlm = mul([1, 0, 0, 1, 0, -T.tl], T.tlm); T.tm = T.tlm.slice(); break;
        case 'Tj': show(o, a.filter(function (x) { return x.t === 'str'; }).slice(-1)); break;
        case 'TJ': show(o, a[0] && a[0].t === 'arr' ? a[0].v : []); break;
        case "'": T.tlm = mul([1, 0, 0, 1, 0, -T.tl], T.tlm); T.tm = T.tlm.slice(); show(o, a.slice(-1)); break;
        case '"': v = nums(a); T.tw = v[0] || 0; T.tc = v[1] || 0; T.tlm = mul([1, 0, 0, 1, 0, -T.tl], T.tlm); T.tm = T.tlm.slice(); show(o, a.slice(-1)); break;
        case 'g': case 'rg': case 'k': setFill(nums(a)); break;
        case 'sc': case 'scn': v = a.filter(function (x) { return x.t === 'num'; }).map(function (x) { return x.v; }); if (v.length) setFill(v); break;
        case 'Do':
          if (a[0] && a[0].t === 'name') {
            var m = gs.ctm;
            images.push({ name: a[0].v, w: Math.hypot(m[0], m[1]), h: Math.hypot(m[2], m[3]), ctm: m.slice() });
          }
          break;
      }
    }
    return { ops: ops, shows: shows, images: images, fonts: fonts, xobjs: xobjs };
  }

  /* ---------- D12: template analysis and mail-merge ---------- */

  /* Finds runs of text-showing operators on one line that together contain a {{placeholder}}. */
  function findSlots(shows) {
    var slots = [];
    var byLine = [];
    shows.forEach(function (s) {
      if (!s.text) return;
      var line = null;
      for (var i = byLine.length - 1; i >= 0 && i >= byLine.length - 6; i--) {
        var L = byLine[i];
        if (Math.abs(L.y - s.y) < Math.max(1, s.size * 0.35) && Math.abs(L.angle - s.angle) < 1) { line = L; break; }
      }
      if (!line) { line = { y: s.y, angle: s.angle, items: [] }; byLine.push(line); }
      line.items.push(s);
    });
    byLine.forEach(function (L) {
      if (Math.abs(L.angle) < 1) L.items.sort(function (a, b) { return a.x - b.x || a.index - b.index; });
      var joined = '', spans = [];
      L.items.forEach(function (s, k) {
        if (k > 0) {
          var prev = L.items[k - 1];
          var gap = s.x - (prev.x + prev.width);
          if (gap > s.size * 0.18 && !/\s$/.test(joined) && !/^\s/.test(s.text)) joined += ' ';
        }
        spans.push({ from: joined.length, to: joined.length + s.text.length, item: s });
        joined += s.text;
      });
      var re = /\{\{[^{}]*\}\}/g, m, used = [];
      while ((m = re.exec(joined))) {
        var from = m.index, to = m.index + m[0].length;
        var hit = spans.filter(function (sp) { return sp.to > from && sp.from < to; });
        hit.forEach(function (sp) { if (used.indexOf(sp) < 0) used.push(sp); });
      }
      if (!used.length) return;
      used.sort(function (a, b) { return a.from - b.from; });
      /* consecutive used spans form one slot */
      var group = [used[0]];
      function flush() {
        var first = group[0], last = group[group.length - 1];
        var text = joined.slice(first.from, last.to);
        var items = group.map(function (g) { return g.item; });
        var w = (last.item.x + last.item.width) - first.item.x;
        slots.push({ text: text, keys: tokensIn(text), items: items, x: first.item.x, y: first.item.y, size: first.item.size, angle: first.item.angle, width: Math.max(w, first.item.width), style: first.item.style, color: first.item.color, removable: items.every(function (it) { return it.decodable; }) });
      }
      for (var u = 1; u < used.length; u++) {
        var prevIdx = spans.indexOf(group[group.length - 1]);
        if (spans.indexOf(used[u]) === prevIdx + 1) group.push(used[u]);
        else { flush(); group = [used[u]]; }
      }
      flush();
    });
    return slots;
  }

  /* Rewrites a show operator as an empty TJ with the same advance, so text after it on the same line stays put. */
  function blankShow(item) {
    var adv = item.advance + (item.fontSize ? (item.tc * item.glyphs + item.tw * item.spaces) * 1000 / item.fontSize : 0);
    var tj = '[' + (Math.round(-adv * 1000) / 1000) + '] TJ';
    if (item.op === "'") return 'T* ' + tj;
    if (item.op === '"') return item.tw + ' Tw ' + item.tc + ' Tc T* ' + tj;
    return tj;
  }
  function spliceOps(bytes, edits) {
    edits.sort(function (a, b) { return a.s - b.s; });
    var enc = new TextEncoder();
    var parts = [], at = 0, total = 0;
    edits.forEach(function (e) {
      if (e.s < at) return;
      parts.push(bytes.subarray(at, e.s));
      var rep = enc.encode(' ' + e.text + ' ');
      parts.push(rep);
      total += (e.s - at) + rep.length;
      at = e.e;
    });
    parts.push(bytes.subarray(at));
    total += bytes.length - at;
    var out = new Uint8Array(total), p = 0;
    parts.forEach(function (x) { out.set(x, p); p += x.length; });
    return out;
  }

  /* analyzeTemplate(bytes) → { kind, fields, slots, keys, pages, notes }
     kind: 'form' (AcroForm fields), 'text' ({{placeholders}} in page text), 'both', or 'none'.
     Also returns cleanBytes: the template with placeholder text removed, ready for drawing values. */
  async function analyzeTemplate(input, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var bytes = await toBytes(input);
    var doc;
    try { doc = await lib.PDFDocument.load(u8(bytes).slice(0), { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && e.message))) throw passwordError('required', opts.name);
      throw new Error('This template could not be read as a PDF.');
    }
    var notes = [];
    var fields = [];
    try {
      doc.getForm().getFields().forEach(function (f) {
        var kind = f instanceof lib.PDFTextField ? 'text' : f instanceof lib.PDFCheckBox ? 'checkbox' : f instanceof lib.PDFRadioGroup ? 'radio' : f instanceof lib.PDFDropdown ? 'dropdown' : f instanceof lib.PDFOptionList ? 'list' : f instanceof lib.PDFSignature ? 'signature' : 'other';
        if (kind === 'signature' || kind === 'other') return;
        var o = { name: f.getName(), type: kind };
        try { if (kind === 'radio' || kind === 'dropdown' || kind === 'list') o.options = f.getOptions(); } catch (e) {}
        fields.push(o);
      });
    } catch (e) {}
    var std = await stdFontsFor(doc);
    var pages = doc.getPages();
    var slots = [];
    var changed = false;
    for (var p = 0; p < pages.length && p < MAX_PAGES; p++) {
      var content = pageContentBytes(pages[p]);
      if (!content) { notes.push('Page ' + (p + 1) + ' uses a content filter that cannot be read here; its placeholders are covered instead of removed.'); continue; }
      var walked = walkPage(pages[p], content, { std: std });
      var found = findSlots(walked.shows);
      if (!found.length) continue;
      var edits = [];
      found.forEach(function (sl) {
        sl.page = p;
        if (sl.removable) sl.items.forEach(function (it) { edits.push({ s: it.s, e: it.e, text: blankShow(it) }); });
        sl.items = undefined;
        slots.push(sl);
      });
      if (edits.length) { setPageContent(pages[p], spliceOps(content, edits)); changed = true; }
    }
    var cleanBytes = changed ? u8(await doc.save({ useObjectStreams: false })) : u8(bytes);
    /* Check the result with pdf.js: anything still showing {{...}} (inside form XObjects, Type 3 or undecodable fonts) is covered. */
    var pdf = await pdfjsOpen(cleanBytes);
    try {
      for (var q = 0; q < pdf.numPages && q < MAX_PAGES; q++) {
        var page = await pdf.getPage(q + 1);
        var tc = await page.getTextContent();
        var vp = page.getViewport({ scale: 1 });
        tc.items.forEach(function (it) {
          if (!it.str || !/\{\{[^{}]*\}\}/.test(it.str)) return;
          var t = it.transform;
          var size = Math.hypot(t[2], t[3]) || 10;
          var fam = (tc.styles[it.fontName] && tc.styles[it.fontName].fontFamily) || '';
          slots.push({ page: q, text: it.str, keys: tokensIn(it.str), x: t[4], y: t[5], size: size, angle: Math.atan2(t[1], t[0]) * 180 / Math.PI, width: it.width, style: { bold: false, italic: false, family: /mono/.test(fam) ? 'mono' : /serif/.test(fam) && !/sans/.test(fam) ? 'serif' : 'sans' }, color: [0, 0, 0], removable: false, cover: true });
        });
        if (slots.some(function (s) { return s.cover && s.page === q; })) await sampleCovers(page, vp, slots.filter(function (s) { return s.cover && s.page === q; }));
        page.cleanup();
      }
    } finally { pdf.destroy(); }
    if (slots.some(function (s) { return s.cover; })) notes.push('Some placeholders could not be lifted out of the page text. They are covered with a box in the page colour and the value is drawn on top; the original placeholder stays in the file’s hidden text.');
    var keys = [];
    slots.forEach(function (s) { s.keys.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    var kind = fields.length && slots.length ? 'both' : fields.length ? 'form' : slots.length ? 'text' : 'none';
    return { kind: kind, fields: fields, slots: slots, keys: keys, pageCount: pages.length, notes: notes, cleanBytes: cleanBytes, bytes: u8(bytes) };
  }

  async function sampleCovers(page, vp, list) {
    try {
      var scale = 1.5;
      var v = page.getViewport({ scale: scale });
      var c = d.createElement('canvas');
      c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
      var g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: v }).promise;
      list.forEach(function (s) {
        var p1 = v.convertToViewportPoint(s.x, s.y + s.size);
        var p2 = v.convertToViewportPoint(s.x + s.width, s.y - s.size * 0.3);
        var x0 = Math.max(0, Math.floor(Math.min(p1[0], p2[0])) - 3), x1 = Math.min(c.width - 1, Math.ceil(Math.max(p1[0], p2[0])) + 3);
        var y0 = Math.max(0, Math.floor(Math.min(p1[1], p2[1])) - 3), y1 = Math.min(c.height - 1, Math.ceil(Math.max(p1[1], p2[1])) + 3);
        var px = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
        var rs = [], gsm = [], bs = [];
        var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
          if (yy > 0 && yy < h - 1 && xx > 0 && xx < w - 1) continue;
          var o = (yy * w + xx) * 4;
          rs.push(px[o]); gsm.push(px[o + 1]); bs.push(px[o + 2]);
        }
        function med(a) { a.sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] / 255 : 1; }
        s.bg = [med(rs), med(gsm), med(bs)];
      });
      c.width = c.height = 1;
    } catch (e) { list.forEach(function (s) { s.bg = [1, 1, 1]; }); }
  }

  var UNI_FONTS = { sans: 'Plus Jakarta Sans', serif: 'Lora', mono: 'Plus Jakarta Sans' }; /* Inter subsets badly and IBM Plex Mono's WOFF does not parse in the vendored fontkit */
  function stdNameFor(style) {
    var b = style && style.bold, i = style && style.italic, f = style && style.family;
    if (f === 'serif') return b && i ? 'TimesRomanBoldItalic' : b ? 'TimesRomanBold' : i ? 'TimesRomanItalic' : 'TimesRoman';
    if (f === 'mono') return b && i ? 'CourierBoldOblique' : b ? 'CourierBold' : i ? 'CourierOblique' : 'Courier';
    return b && i ? 'HelveticaBoldOblique' : b ? 'HelveticaBold' : i ? 'HelveticaOblique' : 'Helvetica';
  }
  function winAnsiOk(text) {
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 32 && c !== 9) return false;
      if (c <= 126 || (c >= 160 && c <= 255)) continue;
      var ok = false;
      for (var k in WIN_HIGH) if (WIN_HIGH[k] === c) { ok = true; break; }
      if (!ok) return false;
    }
    return true;
  }
  /* A font that can draw this text: a standard font when it fits WinAnsi, else a bundled Unicode font (LE.fonts). */
  async function fontFor(doc, text, style, cache) {
    var lib = PL();
    cache = cache || doc.__lebFonts || (doc.__lebFonts = {});
    if (winAnsiOk(text)) {
      var nm = stdNameFor(style);
      if (!cache[nm]) cache[nm] = await doc.embedFont(lib.StandardFonts[nm]);
      return cache[nm];
    }
    var fam = UNI_FONTS[(style && style.family) || 'sans'] || 'Plus Jakarta Sans';
    var key = 'u:' + fam + (style && style.bold ? 'b' : '');
    if (cache[key]) return cache[key];
    if (LE.fonts && LE.fonts.bytes) {
      try {
        var buf = await LE.fonts.bytes(fam, style && style.bold ? 700 : 400, false);
        if (!doc.__lebFk) { doc.registerFontkit(global.fontkit); doc.__lebFk = true; }
        cache[key] = await doc.embedFont(u8(buf), { subset: true });
        return cache[key];
      } catch (e) {}
    }
    var e2 = new Error('The text “' + text.slice(0, 40) + '” has characters no available font can show.');
    e2.code = 'font';
    throw e2;
  }
  function safeText(font, text) {
    /* drops characters the font cannot encode instead of failing the whole file */
    try { font.encodeText(text); return text; } catch (e) {}
    var out = '';
    for (var i = 0; i < text.length; i++) { try { font.encodeText(text.charAt(i)); out += text.charAt(i); } catch (e2) { out += '?'; } }
    return out;
  }

  async function drawSlots(doc, slots, row, opts) {
    var lib = PL();
    var pages = doc.getPages();
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var page = pages[s.page];
      if (!page) continue;
      var text = fillText(s.text, row, { mapping: opts.mapping, dateOrder: opts.dateOrder, extra: opts.extra });
      if (s.cover) {
        var bg = s.bg || [1, 1, 1];
        page.drawRectangle({ x: s.x - 1, y: s.y - s.size * 0.28, width: s.width + 2, height: s.size * 1.22, color: lib.rgb(bg[0], bg[1], bg[2]), rotate: lib.degrees(s.angle || 0) });
      }
      if (!text.trim()) continue;
      var font = await fontFor(doc, text, s.style);
      var c = s.color || [0, 0, 0];
      page.drawText(safeText(font, text), { x: s.x, y: s.y, size: s.size, font: font, color: lib.rgb(clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)), rotate: lib.degrees(s.angle || 0) });
    }
  }

  function fillFields(doc, fields, row, opts) {
    var lib = PL();
    var form = doc.getForm();
    var problems = [];
    var needsUnicode = false;
    fields.forEach(function (f) {
      var col = opts.mapping && opts.mapping[f.name];
      if (!col) return;
      var lookup = rowLookup(row);
      var v = lookup.has(normKey(col)) ? cellText(lookup.get(normKey(col))) : '';
      var field;
      try { field = form.getField(f.name); } catch (e) { return; }
      try {
        if (f.type === 'text') { field.setText(v); if (!winAnsiOk(v)) needsUnicode = true; }
        else if (f.type === 'checkbox') { if (/^(1|y|yes|true|x|on|checked|✓)$/i.test(v.trim())) field.check(); else field.uncheck(); }
        else if (f.type === 'radio' || f.type === 'dropdown') {
          if (!v) return;
          var optsList = f.options || [];
          var match = optsList.filter(function (o) { return normKey(o) === normKey(v); })[0];
          if (match) field.select(match);
          else if (f.type === 'dropdown') field.select(v);
          else problems.push('“' + v + '” is not one of the choices for ' + f.name + '.');
        } else if (f.type === 'list') { if (v) field.select(v.split(/\s*;\s*/)); }
      } catch (e) { problems.push('Could not set ' + f.name + '.'); }
    });
    return { problems: problems, needsUnicode: needsUnicode, form: form };
  }

  function autoMap(targets, columns) {
    var map = {};
    var cols = columns.map(function (c) { return { c: c, k: normKey(c) }; });
    targets.forEach(function (t) {
      var k = normKey(t);
      var hit = cols.filter(function (c) { return c.k === k; })[0] ||
        cols.filter(function (c) { return c.k && k && (c.k.indexOf(k) === 0 || k.indexOf(c.k) === 0); })[0] ||
        cols.filter(function (c) { return c.k && k && c.k.length > 2 && k.length > 2 && (c.k.indexOf(k) >= 0 || k.indexOf(c.k) >= 0); })[0];
      map[t] = hit ? hit.c : '';
    });
    return map;
  }

  function passwordFor(row, cfg, opts) {
    if (!cfg || !cfg.mode || cfg.mode === 'none') return '';
    if (cfg.mode === 'column') {
      var lk = rowLookup(row);
      return lk.has(normKey(cfg.column)) ? cellText(lk.get(normKey(cfg.column))).trim() : '';
    }
    if (cfg.mode === 'pattern') return fillText(cfg.pattern || '', row, { dateOrder: opts && opts.dateOrder }).trim();
    if (cfg.mode === 'same') return String(cfg.password || '');
    return '';
  }

  /* validateRows(rows, plan) → { ok, errors[], warnings[], names[] }
     plan: { targets, mapping, namePattern, password, dateOrder } */
  function validateRows(rows, plan) {
    plan = plan || {};
    var errors = [], warnings = [];
    var mapping = plan.mapping || {};
    var targets = plan.targets || Object.keys(mapping);
    if (!rows || !rows.length) errors.push({ row: 0, message: 'The data has no rows.' });
    if (rows && rows.length > MAX_ROWS) errors.push({ row: 0, message: 'More than ' + MAX_ROWS + ' rows. Split the sheet into smaller parts.' });
    targets.forEach(function (t) { if (!mapping[t]) warnings.push({ row: 0, message: '“' + t + '” has no column, so it will be left empty.' }); });
    var rawNames = [];
    (rows || []).forEach(function (row, i) {
      var n = i + 1;
      var lk = rowLookup(row);
      targets.forEach(function (t) {
        var col = mapping[t];
        if (!col) return;
        var v = lk.has(normKey(col)) ? cellText(lk.get(normKey(col))).trim() : '';
        if (!v) warnings.push({ row: n, message: 'Row ' + n + ': “' + col + '” is empty.' });
      });
      var miss = [];
      var name = fillText(plan.namePattern || 'document-{{#}}', row, { extra: { '#': String(n) }, missing: miss, dateOrder: plan.dateOrder });
      if (!name.replace(/[\s\-_.]/g, '')) errors.push({ row: n, message: 'Row ' + n + ': the file name would be empty.' });
      miss.forEach(function (m) { if (m !== '#') errors.push({ row: n, message: 'Row ' + n + ': the file name uses {{' + m + '}}, which is not a column.' }); });
      rawNames.push(sanitizeName(name));
      if (plan.password && plan.password.mode && plan.password.mode !== 'none') {
        var pw = passwordFor(row, plan.password, plan);
        if (!pw) errors.push({ row: n, message: 'Row ' + n + ': no password (the ' + (plan.password.mode === 'column' ? 'column “' + plan.password.column + '”' : 'pattern') + ' is empty for this row).' });
        else if (pw.length < 6) warnings.push({ row: n, message: 'Row ' + n + ': the password is shorter than 6 characters.' });
      }
    });
    var u = uniqueNames(rawNames);
    u.duplicates.forEach(function (dp) { warnings.push({ row: dp.index + 1, message: 'Row ' + (dp.index + 1) + ': the file name “' + dp.name + '” is already used, so it becomes “' + dp.renamed + '”.' }); });
    var seenErr = {};
    errors = errors.filter(function (e) { var k = e.message; if (seenErr[k]) return false; seenErr[k] = 1; return true; });
    return { ok: !errors.length, errors: errors, warnings: warnings, names: u.names };
  }

  /* mailMerge(template, rows, opts) → { files: [{ name, bytes, row }], summary (CSV text), report }
     template: PDF bytes/File (forms and/or {{placeholders}}), an analyzeTemplate() result, or a function (row, i) → bytes
       for templates built elsewhere (the studio's own text boxes).
     opts: { mapping, flatten, namePattern, password: { mode: 'none'|'column'|'pattern'|'same', column, pattern, password },
             ownerPassword, permissions, watermark: (see watermark()), dateOrder, onProgress, signal } */
  async function mailMerge(template, rows, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var plan = null, builder = null;
    if (typeof template === 'function') builder = template;
    else plan = template && template.cleanBytes ? template : await analyzeTemplate(template, opts);
    var targets = plan ? plan.keys.concat(plan.fields.map(function (f) { return f.name; })) : (opts.targets || []);
    var mapping = opts.mapping || autoMap(targets, opts.columns || Object.keys(rows[0] || {}));
    var check = validateRows(rows, { targets: targets, mapping: mapping, namePattern: opts.namePattern, password: opts.password, dateOrder: opts.dateOrder });
    if (!check.ok) {
      var ve = new Error('Some rows need fixing before the merge can run.');
      ve.code = 'invalid';
      ve.validation = check;
      throw ve;
    }
    var files = [], summaryRows = [], report = { rows: rows.length, protected: 0, watermarked: 0, warnings: [], unicodeFonts: 0 };
    var crypt = opts.password && opts.password.mode && opts.password.mode !== 'none' ? await cryptLib() : null;
    var reuseStd = null;
    for (var i = 0; i < rows.length; i++) {
      checkCancel(opts);
      progress(opts, i, rows.length, 'Row ' + (i + 1) + ' of ' + rows.length);
      var row = rows[i];
      var base = builder ? u8(await builder(row, i)) : plan.cleanBytes;
      var doc = await lib.PDFDocument.load(base.slice(0), { updateMetadata: false });
      var rowPlan = plan;
      if (builder && opts.analyzeEachRow) { rowPlan = await analyzeTemplate(base); doc = await lib.PDFDocument.load(rowPlan.cleanBytes.slice(0), { updateMetadata: false }); }
      if (rowPlan && rowPlan.slots.length) await drawSlots(doc, rowPlan.slots, row, { mapping: mapping, dateOrder: opts.dateOrder });
      if (rowPlan && rowPlan.fields.length) {
        var res = fillFields(doc, rowPlan.fields, row, { mapping: mapping });
        res.problems.forEach(function (p) { report.warnings.push('Row ' + (i + 1) + ': ' + p); });
        if (res.needsUnicode) {
          try {
            var uf = await fontFor(doc, 'Ā', { family: 'sans' });
            res.form.updateFieldAppearances(uf);
            report.unicodeFonts++;
          } catch (e) { report.warnings.push('Row ' + (i + 1) + ': some characters could not be shown in the form fields.'); }
        }
        if (opts.flatten) { try { res.form.flatten(); } catch (e) { report.warnings.push('Row ' + (i + 1) + ': the form could not be flattened.'); } }
      }
      if (opts.watermark && opts.watermark.text) {
        var wmText = fillText(opts.watermark.text, row, { mapping: mapping, extra: { date: opts.watermark.date || todayText() }, dateOrder: opts.dateOrder });
        await drawWatermark(doc, wmText, opts.watermark);
        report.watermarked++;
      }
      if (opts.title) doc.setTitle(fillText(opts.title, row, { mapping: mapping }));
      doc.setProducer('LocalEditor');
      doc.setModificationDate(new Date());
      var out = u8(await doc.save({ useObjectStreams: true }));
      doc = null;
      var pw = crypt ? passwordFor(row, opts.password, opts) : '';
      if (pw) {
        out = await protect(out, { userPassword: pw, ownerPassword: opts.ownerPassword, permissions: opts.permissions });
        report.protected++;
      }
      pw = '';
      files.push({ name: check.names[i], bytes: out, row: i + 1 });
      summaryRows.push([String(i + 1), check.names[i], crypt ? 'yes' : 'no', opts.watermark && opts.watermark.text ? 'yes' : 'no', String(out.length)]);
      if (i % 4 === 3) await tick();
    }
    checkCancel(opts);
    progress(opts, rows.length, rows.length, 'Done');
    var summary = toCsv(['row', 'file', 'password_protected', 'watermarked', 'bytes'], summaryRows);
    return { files: files, summary: summary, report: report, validation: check };
  }

  /* Renders one merged row to bytes (for previews). */
  async function previewRow(plan, row, opts) {
    var r = await mailMerge(plan, [row], Object.assign({}, opts || {}, { password: null, namePattern: 'preview', onProgress: null }));
    return r.files[0].bytes;
  }

  /* ---------- D7: watermarks ---------- */

  function todayText() {
    try { return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return new Date().toDateString(); }
  }
  function hexRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return [0.85, 0.2, 0.2];
    var n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function pageBox(page) {
    var b;
    try { b = page.getCropBox(); } catch (e) { b = null; }
    if (!b) { var mb = page.getMediaBox(); b = mb; }
    return b;
  }
  /* Maps a point in the page as seen (after /Rotate) to PDF user space. */
  function visualToUser(box, rot, vx, vy) {
    rot = ((rot % 360) + 360) % 360;
    if (rot === 90) return { x: box.x + vy, y: box.y + vx };
    if (rot === 180) return { x: box.x + box.width - vx, y: box.y + vy * -1 + box.height };
    if (rot === 270) return { x: box.x + box.width - vy, y: box.y + box.height - vx };
    return { x: box.x + vx, y: box.y + vy };
  }

  /* Draws visible watermark text as real page content on every page.
     cfg: { style: 'diagonal'|'tiled'|'footer', size, opacity, color, traceId, traceMark } */
  async function drawWatermark(doc, text, cfg) {
    var lib = PL();
    cfg = cfg || {};
    var style = cfg.style || 'diagonal';
    var font = await fontFor(doc, text + (cfg.traceId || ''), { family: 'sans', bold: style !== 'footer' });
    text = safeText(font, text);
    var color = lib.rgb.apply(null, hexRgb(cfg.color || '#C62828'));
    var opacity = clamp(num(cfg.opacity, 0.18), 0.03, 1);
    var pages = doc.getPages();
    var small = cfg.traceMark && cfg.traceId ? await fontFor(doc, cfg.traceId, { family: 'mono' }) : null;
    pages.forEach(function (page) {
      var box = pageBox(page);
      var rot = 0;
      try { rot = page.getRotation().angle || 0; } catch (e) {}
      rot = ((rot % 360) + 360) % 360;
      var vw = rot % 180 ? box.height : box.width, vh = rot % 180 ? box.width : box.height;
      function put(t, vx, vy, size, angle, f, col, op) {
        var p = visualToUser(box, rot, vx, vy);
        page.drawText(t, { x: p.x, y: p.y, size: size, font: f, color: col, opacity: op, rotate: lib.degrees(angle + rot) });
      }
      function centred(t, cx, cy, size, angle, f, col, op) {
        var w = f.widthOfTextAtSize(t, size), h = f.heightAtSize(size, { descender: false }) * 0.72;
        var a = angle * Math.PI / 180;
        var ox = cx - (Math.cos(a) * w / 2 - Math.sin(a) * h / 2);
        var oy = cy - (Math.sin(a) * w / 2 + Math.cos(a) * h / 2);
        put(t, ox, oy, size, angle, f, col, op);
      }
      if (style === 'footer') {
        var fs = num(cfg.size, 9);
        var w = font.widthOfTextAtSize(text, fs);
        if (w > vw - 24) { fs = fs * (vw - 24) / w; w = font.widthOfTextAtSize(text, fs); }
        put(text, (vw - w) / 2, 14, fs, 0, font, color, Math.max(opacity, 0.5));
      } else if (style === 'tiled') {
        var ts = num(cfg.size, 22);
        var tw = font.widthOfTextAtSize(text, ts);
        var stepX = tw * 0.8 + ts * 3, stepY = ts * 6;
        var rows = 0;
        for (var y = -vh * 0.2; y < vh * 1.2 && rows < 60; y += stepY, rows++) {
          var shift = (rows % 2) * stepX / 2;
          for (var x = -vw * 0.3 + shift; x < vw * 1.2; x += stepX) centred(text, x, y, ts, 35, font, color, opacity);
        }
      } else {
        var size = num(cfg.size, 0) || 0;
        var diag = Math.hypot(vw, vh);
        var angle = Math.atan2(vh, vw) * 180 / Math.PI;
        var w1 = font.widthOfTextAtSize(text, 10);
        var auto = Math.min(110, 10 * diag * 0.78 / Math.max(w1, 1));
        size = size ? Math.min(size, auto) : auto;
        centred(text, vw / 2, vh / 2, size, angle, font, color, opacity);
      }
      if (small) {
        var grey = lib.rgb(0.55, 0.55, 0.55);
        var t2 = cfg.traceId;
        [[6, 4], [vw - 6 - small.widthOfTextAtSize(t2, 3), 4], [vw / 2, vh - 6], [6, vh / 2]].forEach(function (pt) { put(t2, pt[0], pt[1], 3, 0, small, grey, 0.35); });
      }
    });
  }

  function traceId() {
    var a = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    var b = randomBytes(8), s = '';
    for (var i = 0; i < 8; i++) s += a.charAt(b[i] & 31);
    return 'LE-' + s.slice(0, 4) + '-' + s.slice(4);
  }

  /* watermark(bytes, text, cfg) → Uint8Array (one copy). */
  async function watermark(input, text, cfg) {
    await ready();
    var doc = await PL().PDFDocument.load(u8(await toBytes(input)).slice(0), { updateMetadata: false });
    await drawWatermark(doc, String(text || ''), cfg || {});
    return u8(await doc.save({ useObjectStreams: true }));
  }

  /* watermarkCopies(bytes, recipients, opts) → { files, summary, report }
     recipients: strings or row objects (with opts.nameColumn). opts: { text, style, size, opacity, color, trace, namePattern,
     password (as in mailMerge), date, onProgress, signal } */
  async function watermarkCopies(input, recipients, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var bytes = u8(await toBytes(input));
    try { await lib.PDFDocument.load(bytes.slice(0), { updateMetadata: false }); }
    catch (e) { if (/encrypt/i.test(String(e && e.message))) throw passwordError('required', opts.name); throw new Error('This file could not be read as a PDF.'); }
    var rows = (recipients || []).map(function (r) { return typeof r === 'string' ? { name: r } : r; }).filter(function (r) { return r && Object.keys(r).length; });
    var nameCol = opts.nameColumn || 'name';
    rows = rows.filter(function (r) { return cellText(rowLookup(r).get(normKey(nameCol))).trim(); });
    if (!rows.length) throw new Error('Add at least one recipient.');
    if (rows.length > MAX_ROWS) throw new Error('More than ' + MAX_ROWS + ' recipients.');
    var date = opts.date || todayText();
    var textTpl = opts.text || 'Confidential — issued to {{name}} — {{date}}';
    var namePattern = opts.namePattern || '{{file}} - {{name}}';
    var baseFile = String(opts.fileName || 'document').replace(/\.pdf$/i, '');
    var names = uniqueNames(rows.map(function (r) { return sanitizeName(fillText(namePattern, r, { extra: { file: baseFile, date: date, name: cellText(rowLookup(r).get(normKey(nameCol))) } })); })).names;
    var crypt = opts.password && opts.password.mode && opts.password.mode !== 'none' ? await cryptLib() : null;
    var files = [], summary = [], ids = {};
    for (var i = 0; i < rows.length; i++) {
      checkCancel(opts);
      progress(opts, i, rows.length, 'Copy ' + (i + 1) + ' of ' + rows.length);
      var r = rows[i];
      var who = cellText(rowLookup(r).get(normKey(nameCol))).trim();
      var id = '';
      if (opts.trace !== false) { do { id = traceId(); } while (ids[id]); ids[id] = 1; }
      var doc = await lib.PDFDocument.load(bytes.slice(0), { updateMetadata: false });
      var text = fillText(textTpl, r, { extra: { name: who, date: date, id: id } });
      await drawWatermark(doc, text, { style: opts.style, size: opts.size, opacity: opts.opacity, color: opts.color, traceId: id, traceMark: opts.trace !== false });
      if (id) {
        doc.getInfoDict().set(lib.PDFName.of('LocalEditorCopyId'), lib.PDFString.of(id));
      }
      doc.setProducer('LocalEditor');
      doc.setModificationDate(new Date());
      var out = u8(await doc.save({ useObjectStreams: true }));
      var pw = crypt ? passwordFor(r, opts.password, opts) : '';
      if (pw) out = await protect(out, { userPassword: pw, ownerPassword: opts.ownerPassword, permissions: opts.permissions });
      pw = '';
      files.push({ name: names[i], bytes: out, recipient: who, id: id });
      summary.push([who, names[i], id, crypt ? 'yes' : 'no']);
      if (i % 4 === 3) await tick();
    }
    checkCancel(opts);
    progress(opts, rows.length, rows.length, 'Done');
    return { files: files, summary: toCsv(['recipient', 'file', 'identifier', 'password_protected'], summary), report: { copies: files.length, traced: opts.trace !== false } };
  }

  /* ---------- D13: split by text ---------- */

  function normSpace(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /* Text lines of one page from pdf.js, left to right, top to bottom (viewport coordinates at scale 1). */
  async function pageLinesOf(pdf, pageIndex) {
    var page = await pdf.getPage(pageIndex + 1);
    var vp = page.getViewport({ scale: 1 });
    var tc = await page.getTextContent();
    var items = [];
    tc.items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var t = global.pdfjsLib.Util.transform(vp.transform, it.transform);
      var size = Math.hypot(t[2], t[3]) || 10;
      if (Math.abs(t[1]) > 0.01 * size) return; /* skip rotated text */
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width * vp.scale, h: size, size: size });
    });
    page.cleanup();
    items.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [];
    items.forEach(function (it) {
      var L = lines.filter(function (l) { return Math.abs(l.y - it.y) < it.size * 0.4; })[0];
      if (!L) { L = { y: it.y, items: [] }; lines.push(L); }
      L.items.push(it);
    });
    lines.forEach(function (L) {
      L.items.sort(function (a, b) { return a.x - b.x; });
      var text = '';
      L.items.forEach(function (it, k) {
        it.start = text.length;
        if (k) {
          var p = L.items[k - 1];
          var gap = it.x - (p.x + p.w);
          if (gap > it.size * 1.2) text += '    ';
          else if (gap > it.size * 0.12 && !/\s$/.test(text)) text += ' ';
          it.start = text.length;
        }
        text += it.str;
      });
      L.text = text;
      L.x = L.items[0].x;
    });
    lines.sort(function (a, b) { return a.y - b.y; });
    return { width: vp.width, height: vp.height, lines: lines, empty: !items.length };
  }

  /* Suggests a rule from a clicked text item: the label before it on the same line (or the line above) and its value. */
  function ruleFromClick(pageLines, lineIndex, itemIndex) {
    var L = pageLines.lines[lineIndex];
    if (!L) return null;
    var it = L.items[itemIndex];
    if (!it) return null;
    var str = it.str;
    var colon = str.lastIndexOf(':');
    if (colon > 0 && normSpace(str.slice(colon + 1))) {
      return { mode: 'text', label: normSpace(str.slice(0, colon + 1)), where: 'after', value: normSpace(str.slice(colon + 1)) };
    }
    if (itemIndex > 0) {
      var before = L.text.slice(0, it.start).replace(/\s+$/, '');
      var parts = before.split(/\s{3,}/);
      var label = normSpace(parts[parts.length - 1]);
      if (label) return { mode: 'text', label: label, where: 'after', value: valueAfter(L.text.slice(it.start)) };
    }
    /* nothing before it on the line: use the closest line above that overlaps */
    for (var k = lineIndex - 1; k >= 0 && k >= lineIndex - 2; k--) {
      var up = pageLines.lines[k];
      var over = up.items.filter(function (u) { return u.x < it.x + it.w + it.size && u.x + u.w > it.x - it.size; })[0];
      if (over) return { mode: 'text', label: normSpace(over.str), where: 'below', value: normSpace(str) };
    }
    return { mode: 'text', label: '', where: 'after', value: normSpace(str) };
  }
  function valueAfter(rest) {
    rest = String(rest || '').replace(/^[\s:#.\-–—]+/, '');
    var v = rest.split(/\s{3,}|\t/)[0];
    return normSpace(v).replace(/[\s,;]+$/, '');
  }
  function findValue(pl, rule) {
    var label = normSpace(rule.label).toLowerCase();
    if (!label) return null;
    for (var i = 0; i < pl.lines.length; i++) {
      var L = pl.lines[i];
      var hay = L.text.toLowerCase();
      var at = hay.indexOf(label);
      if (at < 0) { var squashed = normSpace(L.text).toLowerCase(); at = squashed.indexOf(label); if (at >= 0) { var v0 = valueAfter(normSpace(L.text).slice(at + label.length)); if (rule.where !== 'below' && v0) return v0; } continue; }
      if (rule.where === 'below') {
        var next = pl.lines[i + 1];
        if (!next) continue;
        var lx = L.items.filter(function (it) { return it.start <= at && it.start + it.str.length > at; })[0] || L.items[0];
        var under = next.items.filter(function (u) { return u.x < lx.x + lx.w + lx.size * 4 && u.x + u.w > lx.x - lx.size; });
        if (under.length) return normSpace(under.map(function (u) { return u.str; }).join(' '));
        continue;
      }
      var v = valueAfter(L.text.slice(at + label.length));
      if (v) return v;
    }
    return null;
  }

  function isBlankCanvas(c) {
    var g = c.getContext('2d', { willReadFrequently: true });
    var px = g.getImageData(0, 0, c.width, c.height).data;
    var dark = 0;
    for (var i = 0; i < px.length; i += 4) if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) dark++;
    return dark / (px.length / 4) < 0.002;
  }

  /* splitPlan(bytes, rule, opts) → { groups: [{ name, value, pages }], noText: [pageIndex], skipped: [pageIndex], warnings }
     rule: { mode: 'text', label, where: 'after'|'below' } | { mode: 'every', n } | { mode: 'bookmarks', level }
           | { mode: 'blank', keepBlank } | { mode: 'size', maxBytes }
     opts: { namePattern ('{{value}}'), fileName, onProgress, signal, password } */
  async function splitPlan(input, rule, opts) {
    opts = opts || {};
    rule = rule || {};
    await ready();
    var bytes = u8(await toBytes(input));
    var pdf;
    try { pdf = await pdfjsOpen(bytes, opts.password); }
    catch (e) { if (e && e.name === 'PasswordException') throw passwordError(e.code === 2 ? 'incorrect' : 'required', opts.name); throw new Error('This file could not be read as a PDF.'); }
    var n = pdf.numPages;
    var groups = [], noText = [], skipped = [], warnings = [];
    try {
      if (n > MAX_PAGES) throw new Error('This PDF has more than ' + MAX_PAGES + ' pages.');
      if (rule.mode === 'every') {
        var step = Math.max(1, Math.round(num(rule.n, 1)));
        for (var a = 0; a < n; a += step) { var pg = []; for (var b = a; b < Math.min(n, a + step); b++) pg.push(b); groups.push({ value: '', pages: pg }); }
      } else if (rule.mode === 'bookmarks') {
        var outline = await pdf.getOutline() || [];
        var level = Math.max(1, Math.round(num(rule.level, 1)));
        var marks = [];
        async function walk(items, depth) {
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (depth === level) {
              var p = null;
              try {
                var dest = it.dest;
                if (typeof dest === 'string') dest = await pdf.getDestination(dest);
                if (dest && dest[0] != null) p = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
              } catch (e) { p = null; }
              if (p != null) marks.push({ title: normSpace(it.title), page: p });
            } else if (it.items && it.items.length) await walk(it.items, depth + 1);
          }
        }
        await walk(outline, 1);
        if (!marks.length) throw new Error(outline.length ? 'No bookmarks at that level point to a page.' : 'This PDF has no bookmarks.');
        marks.sort(function (x, y) { return x.page - y.page; });
        if (marks[0].page > 0) { var lead = []; for (var q = 0; q < marks[0].page; q++) lead.push(q); groups.push({ value: '', pages: lead, unmatched: true }); }
        marks.forEach(function (m, k) {
          var end = k + 1 < marks.length ? marks[k + 1].page : n;
          if (end <= m.page) { if (groups.length) groups[groups.length - 1].value += ''; return; }
          var pp = []; for (var r = m.page; r < end; r++) pp.push(r);
          groups.push({ value: m.title, pages: pp });
        });
      } else if (rule.mode === 'blank') {
        var cur = [];
        for (var p2 = 0; p2 < n; p2++) {
          checkCancel(opts);
          progress(opts, p2, n, 'Checking page ' + (p2 + 1));
          var page = await pdf.getPage(p2 + 1);
          var tc = await page.getTextContent();
          var blank = false;
          if (!tc.items.some(function (it) { return it.str && it.str.trim(); })) {
            var vp = page.getViewport({ scale: 0.4 });
            var c = d.createElement('canvas');
            c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
            var g = c.getContext('2d', { willReadFrequently: true });
            g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: g, viewport: vp }).promise;
            blank = isBlankCanvas(c);
            c.width = c.height = 1;
          }
          page.cleanup();
          if (blank) {
            skipped.push(p2);
            if (rule.keepBlank) cur.push(p2);
            if (cur.length) groups.push({ value: '', pages: cur });
            cur = [];
          } else cur.push(p2);
        }
        if (cur.length) groups.push({ value: '', pages: cur });
        if (!skipped.length) warnings.push('No blank pages were found, so the file stays in one part.');
      } else if (rule.mode === 'size') {
        var max = Math.max(50 * 1024, num(rule.maxBytes, 5 * 1024 * 1024));
        var lib = PL();
        var src = await lib.PDFDocument.load(bytes.slice(0), { updateMetadata: false });
        var sizes = [];
        for (var p3 = 0; p3 < n; p3++) {
          checkCancel(opts);
          progress(opts, p3, n, 'Measuring page ' + (p3 + 1));
          var one = await lib.PDFDocument.create();
          var cp = await one.copyPages(src, [p3]);
          one.addPage(cp[0]);
          sizes.push((await one.save({ useObjectStreams: true })).length);
          if (p3 % 6 === 5) await tick();
        }
        var curr = [], tot = 0;
        sizes.forEach(function (s, idx) {
          if (curr.length && tot + s > max) { groups.push({ value: '', pages: curr }); curr = []; tot = 0; }
          curr.push(idx); tot += s;
          if (s > max) warnings.push('Page ' + (idx + 1) + ' alone is larger than the limit (' + Math.round(s / 1024) + ' KB).');
        });
        if (curr.length) groups.push({ value: '', pages: curr });
        warnings.push('Sizes are estimated page by page; shared fonts make real files a little smaller.');
      } else {
        if (!normSpace(rule.label)) throw new Error('Choose the text that comes before the value, such as “Employee ID:”.');
        var current = null;
        for (var p4 = 0; p4 < n; p4++) {
          checkCancel(opts);
          progress(opts, p4, n, 'Reading page ' + (p4 + 1));
          var pl = await pageLinesOf(pdf, p4);
          if (pl.empty) { noText.push(p4); }
          var v = pl.empty ? null : findValue(pl, rule);
          if (v && (!current || normSpace(current.value).toLowerCase() !== v.toLowerCase())) {
            current = { value: v, pages: [p4] };
            groups.push(current);
          } else if (current) {
            current.pages.push(p4);
            if (!v && !pl.empty) current.continued = (current.continued || 0) + 1;
          } else {
            current = { value: '', pages: [p4], unmatched: true };
            groups.push(current);
          }
          if (p4 % 8 === 7) await tick();
        }
        if (!groups.some(function (g2) { return g2.value; })) warnings.push('“' + normSpace(rule.label) + '” was not found on any page.');
        if (noText.length) warnings.push(noText.length + ' page' + (noText.length === 1 ? ' has' : 's have') + ' no text layer (scanned?): ' + pageList(noText) + '. They were kept with the pages before them; check them below.');
        /* the same value appearing again later is a separate group; flag it */
        var seen = {};
        groups.forEach(function (g3) { var k = g3.value.toLowerCase(); if (k && seen[k]) warnings.push('“' + g3.value + '” appears in more than one place; those become separate files.'); seen[k] = 1; });
      }
    } finally { try { pdf.destroy(); } catch (e) {} }
    progress(opts, n, n, 'Done');
    nameGroups(groups, opts);
    return { groups: groups, noText: noText, skipped: skipped, warnings: warnings, pageCount: n };
  }
  function pageList(list) {
    var out = [], i = 0;
    while (i < list.length) {
      var j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      out.push(j > i ? (list[i] + 1) + '–' + (list[j] + 1) : String(list[i] + 1));
      i = j + 1;
    }
    return out.join(', ');
  }
  function nameGroups(groups, opts) {
    var pattern = (opts && opts.namePattern) || '{{value}}';
    var file = String((opts && opts.fileName) || 'document').replace(/\.pdf$/i, '');
    var width = String(groups.length).length;
    var raw = groups.map(function (g, i) {
      var nn = String(i + 1);
      while (nn.length < Math.max(2, width)) nn = '0' + nn;
      var value = g.value || (g.unmatched ? 'before-first-match' : 'part-' + nn);
      return sanitizeName(fillText(pattern, {}, { extra: { value: value, n: nn, file: file, first: String(g.pages[0] + 1), last: String(g.pages[g.pages.length - 1] + 1) } }));
    });
    var u = uniqueNames(raw).names;
    groups.forEach(function (g, i) { if (!g.nameEdited) g.name = u[i]; });
    return groups;
  }

  /* splitApply(bytes, groups, opts) → { files: [{ name, bytes, pages }], summary } */
  async function splitApply(input, groups, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var bytes = u8(await toBytes(input));
    var src = await lib.PDFDocument.load(bytes.slice(0), { updateMetadata: false });
    var total = src.getPageCount();
    var names = uniqueNames(groups.map(function (g) { return sanitizeName(g.name); })).names;
    var files = [], rows = [];
    for (var i = 0; i < groups.length; i++) {
      checkCancel(opts);
      progress(opts, i, groups.length, 'File ' + (i + 1) + ' of ' + groups.length);
      var pages = (groups[i].pages || []).filter(function (p) { return p >= 0 && p < total; });
      if (!pages.length) continue;
      var out = await lib.PDFDocument.create();
      var copied = await out.copyPages(src, pages);
      copied.forEach(function (p) { out.addPage(p); });
      out.setProducer('LocalEditor');
      out.setCreator('LocalEditor');
      if (groups[i].value) out.setTitle(groups[i].value);
      var b = u8(await out.save({ useObjectStreams: true }));
      files.push({ name: names[i], bytes: b, pages: pages });
      rows.push([names[i], groups[i].value || '', pageList(pages), String(pages.length)]);
      if (i % 3 === 2) await tick();
    }
    checkCancel(opts);
    progress(opts, groups.length, groups.length, 'Done');
    return { files: files, summary: toCsv(['file', 'value', 'pages', 'page_count'], rows) };
  }

  /* ---------- D8: compress to a target size ---------- */

  var PRESETS = {
    email: { targetBytes: 10 * 1024 * 1024, label: 'Email (under 10 MB)' },
    '2mb': { targetBytes: 2 * 1024 * 1024, label: 'Under 2 MB' },
    '500kb': { targetBytes: 500 * 1024, label: 'Under 500 KB' },
    lossless: { targetBytes: 0, label: 'Clean up only (no quality change)' }
  };
  var IMAGE_LEVELS = [
    { dpi: 220, quality: 0.85 }, { dpi: 150, quality: 0.8 }, { dpi: 120, quality: 0.72 },
    { dpi: 96, quality: 0.62 }, { dpi: 72, quality: 0.52 }, { dpi: 60, quality: 0.42 }
  ];
  var RASTER_LEVELS = [
    { dpi: 150, quality: 0.75 }, { dpi: 120, quality: 0.65 }, { dpi: 96, quality: 0.55 }, { dpi: 72, quality: 0.45 }, { dpi: 60, quality: 0.38 }
  ];

  function nameStr(o) { return o && o.encodedName ? o.encodedName.replace(/^\//, '') : ''; }

  function replaceRefs(obj, map) {
    var lib = PL();
    if (!obj) return;
    if (obj instanceof lib.PDFDict) {
      obj.entries().forEach(function (kv) {
        var v = kv[1];
        if (v instanceof lib.PDFRef && map.has(v.tag)) obj.set(kv[0], map.get(v.tag));
        else replaceRefs(v, map);
      });
    } else if (obj instanceof lib.PDFArray) {
      for (var i = 0; i < obj.size(); i++) {
        var v2 = obj.get(i);
        if (v2 instanceof lib.PDFRef && map.has(v2.tag)) obj.set(i, map.get(v2.tag));
        else replaceRefs(v2, map);
      }
    } else if (obj.dict instanceof lib.PDFDict) replaceRefs(obj.dict, map);
  }

  async function sha256Hex(bytes) {
    var h = new Uint8Array(await global.crypto.subtle.digest('SHA-256', bytes));
    var s = '';
    for (var i = 0; i < h.length; i++) s += (h[i] < 16 ? '0' : '') + h[i].toString(16);
    return s;
  }

  /* Lossless clean-up: duplicate streams merged, unreachable objects dropped, unfiltered streams deflated,
     page thumbnails removed, document info and XMP removed when asked. pdf-lib then writes a fresh file with object streams. */
  async function losslessDoc(doc, opts, report) {
    var lib = PL(), N = lib.PDFName, ctx = doc.context;
    var all = ctx.enumerateIndirectObjects();
    /* 1. merge identical streams (images, fonts, colour profiles) */
    var byHash = new Map(), dupMap = new Map(), dupCount = 0;
    for (var i = 0; i < all.length; i++) {
      var ref = all[i][0], obj = all[i][1];
      if (!(obj instanceof lib.PDFRawStream)) continue;
      var type = nameStr(obj.dict.lookup(N.of('Type')));
      if (type === 'XRef' || type === 'ObjStm' || type === 'Metadata') continue;
      if (obj.contents.length < 512) continue;
      var key = obj.dict.toString().replace(/\/Length \d+/, '') + '|' + await sha256Hex(obj.contents);
      if (byHash.has(key)) { dupMap.set(ref.tag, byHash.get(key)); dupCount++; }
      else byHash.set(key, ref);
      if (i % 50 === 49) { checkCancel(opts); await tick(); }
    }
    report.duplicatesMerged = dupCount;
    if (dupMap.size) all.forEach(function (pair) { replaceRefs(pair[1], dupMap); });
    /* 2. page thumbnails and (optionally) metadata */
    doc.getPages().forEach(function (p) {
      p.node.delete(N.of('Thumb'));
      if (opts.stripMetadata) { p.node.delete(N.of('PieceInfo')); p.node.delete(N.of('Metadata')); }
    });
    if (opts.stripMetadata) {
      doc.catalog.delete(N.of('Metadata'));
      doc.catalog.delete(N.of('PieceInfo'));
      var info = ctx.lookup(ctx.trailerInfo.Info);
      if (info instanceof lib.PDFDict) info.keys().forEach(function (k) { info.delete(k); });
      report.metadataRemoved = true;
    }
    /* 3. drop what nothing points to */
    report.unusedRemoved = gcContext(ctx, lib);
    /* 4. deflate streams stored without a filter */
    var deflated = 0;
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var o = pair[1];
      if (!(o instanceof lib.PDFRawStream)) return;
      if (o.dict.get(N.of('Filter')) || o.contents.length < 200) return;
      if (nameStr(o.dict.lookup(N.of('Type'))) === 'Metadata') return;
      try {
        var packed = ctx.flateStream(o.contents);
        if (packed.contents.length < o.contents.length * 0.9) {
          var nd = o.dict.clone(ctx);
          nd.set(N.of('Filter'), N.of('FlateDecode'));
          nd.delete(N.of('DecodeParms'));
          ctx.assign(pair[0], lib.PDFRawStream.of(nd, packed.contents));
          deflated++;
        }
      } catch (e) {}
    });
    report.streamsDeflated = deflated;
  }

  /* Where each image XObject is drawn, so its effective resolution is known. Follows form XObjects three levels deep. */
  function imageInventory(doc) {
    var lib = PL(), N = lib.PDFName, ctx = doc.context;
    var inv = new Map();
    function note(ref, w, h, pageW) {
      var e = inv.get(ref.tag);
      if (!e) { e = { ref: ref, w: 0, h: 0, uses: 0, pageW: pageW }; inv.set(ref.tag, e); }
      e.w = Math.max(e.w, w); e.h = Math.max(e.h, h); e.uses++;
    }
    function walk(resources, bytes, ctm, depth, pageW) {
      if (!bytes || depth > 3) return;
      var w = walkPage(null, bytes, { doc: doc, resources: resources, ctm: ctm });
      var xo = resources ? resources.lookup(N.of('XObject')) : null;
      if (!(xo instanceof lib.PDFDict)) return;
      w.images.forEach(function (im) {
        var ref = xo.get(N.of(im.name));
        var obj = ctx.lookup(ref);
        if (!(obj instanceof lib.PDFRawStream) || !(ref instanceof lib.PDFRef)) return;
        var sub = nameStr(obj.dict.lookup(N.of('Subtype')));
        if (sub === 'Image') note(ref, im.w, im.h, pageW);
        else if (sub === 'Form') {
          var m = obj.dict.lookup(N.of('Matrix'));
          var mat = m instanceof lib.PDFArray && m.size() === 6 ? [0, 1, 2, 3, 4, 5].map(function (k) { var x = m.lookup(k); return x && x.asNumber ? x.asNumber() : 0; }) : [1, 0, 0, 1, 0, 0];
          var fr = obj.dict.lookup(N.of('Resources'));
          walk(fr instanceof lib.PDFDict ? fr : resources, streamBytes(obj), mul(mat, im.ctm), depth + 1, pageW);
        }
      });
    }
    doc.getPages().forEach(function (p) {
      var mb = p.getMediaBox();
      walk(p.node.Resources(), pageContentBytes(p), [1, 0, 0, 1, 0, 0], 0, Math.max(mb.width, mb.height));
    });
    /* images that are never drawn from a content stream (patterns, annotations): assume a full page width */
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var o = pair[1];
      if (o instanceof lib.PDFRawStream && nameStr(o.dict.lookup(N.of('Subtype'))) === 'Image' && !inv.has(pair[0].tag)) {
        inv.set(pair[0].tag, { ref: pair[0], w: 0, h: 0, uses: 0, pageW: 612, unplaced: true });
      }
    });
    return inv;
  }

  function filterName(dict) {
    var lib = PL(), N = lib.PDFName;
    var f = dict.lookup(N.of('Filter'));
    if (f instanceof lib.PDFArray) return f.size() === 1 ? nameStr(f.lookup(0)) : f.size() ? 'multi' : '';
    return nameStr(f);
  }

  function imageSkipReason(dict) {
    var lib = PL(), N = lib.PDFName;
    var im = dict.lookup(N.of('ImageMask'));
    if (im && im.asBoolean && im.asBoolean()) return 'masks';
    if (dict.get(N.of('Mask')) || dict.get(N.of('SMask')) || dict.get(N.of('SMaskInData'))) return 'images with transparency masks';
    var filter = filterName(dict);
    if (filter === 'JPXDecode') return 'JPEG 2000 images';
    if (filter === 'JBIG2Decode' || filter === 'CCITTFaxDecode') return 'black-and-white scan images';
    if (filter && filter !== 'DCTDecode' && filter !== 'FlateDecode') return 'images with other compression';
    var bpc = dict.lookup(N.of('BitsPerComponent'));
    if (!bpc || bpc.asNumber() !== 8) return 'images with unusual bit depths';
    var dp = dict.lookup(N.of('DecodeParms'));
    if (dp instanceof lib.PDFArray) dp = dp.lookup(0);
    if (dp instanceof lib.PDFDict) {
      var pr = dp.lookup(N.of('Predictor'));
      if (pr && pr.asNumber() > 1 && filter === 'FlateDecode') return 'predictor-encoded images';
      var ct = dp.lookup(N.of('ColorTransform'));
      if (ct && filter === 'DCTDecode') return 'JPEGs with unusual colour transforms';
    }
    if (dict.get(N.of('Decode'))) return 'images with decode arrays';
    var cs = dict.lookup(N.of('ColorSpace'));
    var comps = 0;
    if (cs instanceof lib.PDFName) { var n = nameStr(cs); comps = n === 'DeviceRGB' ? 3 : n === 'DeviceGray' ? 1 : n === 'DeviceCMYK' ? -1 : 0; }
    else if (cs instanceof lib.PDFArray) {
      var kind = nameStr(cs.lookup(0));
      if (kind === 'ICCBased') { var icc = cs.lookup(1); var nn = icc && icc.dict ? icc.dict.lookup(N.of('N')) : null; comps = nn ? (nn.asNumber() === 4 ? -1 : nn.asNumber()) : 0; }
      else if (kind === 'Indexed') return 'palette images';
      else if (kind === 'Separation' || kind === 'DeviceN') return 'spot-colour images';
    }
    if (comps === -1) return 'CMYK images';
    if (comps !== 1 && comps !== 3) return 'images in other colour spaces';
    return null;
  }

  async function decodeImage(stream) {
    var lib = PL(), N = lib.PDFName, dict = stream.dict;
    var W = dict.lookup(N.of('Width')).asNumber(), H = dict.lookup(N.of('Height')).asNumber();
    if (filterName(dict) === 'DCTDecode') {
      var bmp = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
      return { source: bmp, w: bmp.width, h: bmp.height, close: function () { try { bmp.close(); } catch (e) {} } };
    }
    var raw = lib.decodePDFRawStream(stream).decode();
    var comps = raw.length / (W * H);
    if (comps !== 1 && comps !== 3) throw new Error('unexpected pixel data');
    var c = d.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var id = g.createImageData(W, H), px = id.data;
    for (var i = 0, j = 0; i < W * H; i++, j += 4) {
      if (comps === 3) { px[j] = raw[i * 3]; px[j + 1] = raw[i * 3 + 1]; px[j + 2] = raw[i * 3 + 2]; }
      else { px[j] = px[j + 1] = px[j + 2] = raw[i]; }
      px[j + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return { source: c, w: W, h: H, close: function () { c.width = c.height = 1; } };
  }

  function canvasJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (!b) { reject(new Error('Could not encode JPEG')); return; }
        b.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  async function recompressImages(doc, level, opts, rep) {
    var lib = PL(), N = lib.PDFName, ctx = doc.context;
    var inv = imageInventory(doc);
    var maskRefs = new Set();
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var o = pair[1];
      var dct = o instanceof lib.PDFRawStream ? o.dict : o instanceof lib.PDFDict ? o : null;
      if (!dct) return;
      ['SMask', 'Mask'].forEach(function (k) { var v = dct.get(N.of(k)); if (v instanceof lib.PDFRef) maskRefs.add(v.tag); });
    });
    maskRefs.forEach(function (tag) { inv.delete(tag); });
    var list = Array.from(inv.values());
    rep.found = list.length;
    rep.recompressed = 0;
    rep.skipped = {};
    rep.savedBytes = 0;
    for (var i = 0; i < list.length; i++) {
      checkCancel(opts);
      var e = list[i];
      var stream = ctx.lookup(e.ref);
      if (!(stream instanceof lib.PDFRawStream)) continue;
      var reason = imageSkipReason(stream.dict);
      var W = stream.dict.lookup(N.of('Width')), H = stream.dict.lookup(N.of('Height'));
      W = W && W.asNumber ? W.asNumber() : 0; H = H && H.asNumber ? H.asNumber() : 0;
      if (!reason && (!W || !H)) reason = 'damaged images';
      if (!reason && W * H > MAX_IMAGE_PIXELS) reason = 'images too large to process safely on this device';
      if (reason) { rep.skipped[reason] = (rep.skipped[reason] || 0) + 1; continue; }
      var shownW = e.w || e.pageW || 612, shownH = e.h || (shownW * H / W);
      var dpi = Math.min(W / Math.max(shownW / 72, 0.01), H / Math.max(shownH / 72, 0.01));
      var scale = dpi > level.dpi * 1.15 ? level.dpi / dpi : 1;
      var nw = Math.max(1, Math.round(W * scale)), nh = Math.max(1, Math.round(H * scale));
      var isJpeg = filterName(stream.dict) === 'DCTDecode';
      if (scale === 1 && isJpeg && level.quality >= 0.8) continue;
      var img = null;
      try {
        img = await decodeImage(stream);
        var c = d.createElement('canvas');
        c.width = nw; c.height = nh;
        var g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.fillStyle = '#fff';
        g.fillRect(0, 0, nw, nh);
        g.drawImage(img.source, 0, 0, nw, nh);
        var jpg = await canvasJpeg(c, level.quality);
        c.width = c.height = 1;
        if (jpg.length < stream.contents.length * 0.92) {
          var nd = stream.dict.clone(ctx);
          ['Filter', 'DecodeParms', 'Length', 'Decode'].forEach(function (k) { nd.delete(N.of(k)); });
          nd.set(N.of('Filter'), N.of('DCTDecode'));
          nd.set(N.of('Width'), lib.PDFNumber.of(nw));
          nd.set(N.of('Height'), lib.PDFNumber.of(nh));
          nd.set(N.of('BitsPerComponent'), lib.PDFNumber.of(8));
          var csn = stream.dict.lookup(N.of('ColorSpace'));
          var keepIcc = csn instanceof lib.PDFArray && nameStr(csn.lookup(0)) === 'ICCBased' && csn.lookup(1).dict.lookup(N.of('N')).asNumber() === 3;
          if (!keepIcc) nd.set(N.of('ColorSpace'), N.of('DeviceRGB'));
          rep.savedBytes += stream.contents.length - jpg.length;
          ctx.assign(e.ref, lib.PDFRawStream.of(nd, jpg));
          rep.recompressed++;
        }
      } catch (err) {
        rep.skipped['images the browser could not decode'] = (rep.skipped['images the browser could not decode'] || 0) + 1;
      } finally { if (img) img.close(); }
      if (i % 2 === 1) await tick();
    }
  }

  async function rasterize(bytes, level, opts) {
    var lib = PL();
    var pdf = await pdfjsOpen(bytes);
    var out = await lib.PDFDocument.create();
    try {
      for (var i = 0; i < pdf.numPages; i++) {
        checkCancel(opts);
        progress(opts, i, pdf.numPages, 'Page ' + (i + 1) + ' of ' + pdf.numPages + ' as a picture');
        var page = await pdf.getPage(i + 1);
        var base = page.getViewport({ scale: 1 });
        var scale = level.dpi / 72;
        var area = base.width * base.height * scale * scale;
        if (area > 16e6) scale *= Math.sqrt(16e6 / area);
        var vp = page.getViewport({ scale: scale });
        var c = d.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        var jpg = await canvasJpeg(c, level.quality);
        c.width = c.height = 1;
        var im = await out.embedJpg(jpg);
        var np = out.addPage([base.width, base.height]);
        np.drawImage(im, { x: 0, y: 0, width: base.width, height: base.height });
        page.cleanup();
        await tick();
      }
    } finally { pdf.destroy(); }
    out.setProducer('LocalEditor');
    return u8(await out.save({ useObjectStreams: true }));
  }

  async function textSignature(bytes) {
    await ready();
    var pdf = await pdfjsOpen(await toBytes(bytes));
    var parts = [];
    try {
      for (var i = 0; i < pdf.numPages; i++) {
        var p = await pdf.getPage(i + 1);
        var tc = await p.getTextContent();
        parts.push(tc.items.map(function (it) { return it.str; }).join(''));
        p.cleanup();
      }
    } finally { pdf.destroy(); }
    return parts.join('\n');
  }

  /* compress(bytes, { targetBytes | preset, stripMetadata, allowRaster, onProgress, signal }) → { bytes, report }
     Order: lossless clean-up → recompress/downsample RGB and grey images (JPEG, Flate) level by level → only with allowRaster,
     turn pages into images. Text and vector drawings are never touched before the raster step. */
  async function compress(input, opts) {
    opts = opts || {};
    await ready();
    var lib = PL();
    var original = u8(await toBytes(input));
    var preset = opts.preset && PRESETS[opts.preset] ? PRESETS[opts.preset] : null;
    var target = num(opts.targetBytes, preset ? preset.targetBytes : 0) || 0;
    var report = { originalBytes: original.length, targetBytes: target, steps: [], images: null, reached: false, rasterized: false, textSelectable: true, level: null, notes: [] };
    var doc;
    try { doc = await lib.PDFDocument.load(original.slice(0), { updateMetadata: false }); }
    catch (e) { if (/encrypt/i.test(String(e && e.message))) throw passwordError('required', opts.name); throw new Error('This file could not be read as a PDF.'); }
    progress(opts, 0, 1, 'Cleaning up');
    var clean = {};
    await losslessDoc(doc, opts, clean);
    var best = u8(await doc.save({ useObjectStreams: true }));
    var cleanBytes = best;
    report.steps.push({ step: 'lossless', bytes: best.length });
    report.lossless = clean;
    if (best.length >= original.length && !opts.stripMetadata) { best = original; report.notes.push('The file was already tidy; the clean-up did not make it smaller.'); }
    doc = null;
    if (!target || best.length <= target) {
      report.reached = true;
      report.bytes = best.length;
      progress(opts, 1, 1, 'Done');
      return { bytes: best, report: report };
    }
    var imgRep = null;
    for (var L = 0; L < IMAGE_LEVELS.length; L++) {
      checkCancel(opts);
      var level = IMAGE_LEVELS[L];
      progress(opts, L, IMAGE_LEVELS.length, 'Images at ' + level.dpi + ' dpi');
      var work = await lib.PDFDocument.load(cleanBytes.slice(0), { updateMetadata: false });
      var rep = {};
      await recompressImages(work, level, opts, rep);
      if (!rep.found) { report.notes.push('This PDF has no images to recompress; its size comes from text, fonts or drawings.'); imgRep = rep; break; }
      if (!rep.recompressed) { imgRep = imgRep || rep; continue; }
      var out = u8(await work.save({ useObjectStreams: true }));
      work = null;
      report.steps.push({ step: 'images', dpi: level.dpi, quality: level.quality, bytes: out.length });
      if (out.length < best.length) { best = out; imgRep = rep; report.level = level; }
      if (out.length <= target) break;
      await tick();
    }
    report.images = imgRep;
    report.reached = best.length <= target;
    if (!report.reached && opts.allowRaster) {
      for (var R = 0; R < RASTER_LEVELS.length; R++) {
        checkCancel(opts);
        var rl = RASTER_LEVELS[R];
        var rb = await rasterize(original, rl, opts);
        report.steps.push({ step: 'raster', dpi: rl.dpi, quality: rl.quality, bytes: rb.length });
        if (rb.length < best.length) { best = rb; report.rasterized = true; report.textSelectable = false; report.level = rl; }
        if (rb.length <= target) break;
      }
      report.reached = best.length <= target;
      if (report.rasterized) report.notes.push('Pages were turned into pictures. Text can no longer be selected, searched or read aloud, and links are gone.');
    }
    if (!report.reached) report.notes.push(report.rasterized || opts.allowRaster ? 'Even as pictures this file stays above the target.' : 'The target cannot be reached without turning pages into pictures (text would no longer be selectable).');
    report.bytes = best.length;
    progress(opts, 1, 1, 'Done');
    return { bytes: best, report: report };
  }

  /* ---------- output ---------- */

  /* zip(files, extra) → Blob. files: [{ name, bytes }]; extra: [{ name, text }] (e.g. summary.csv). Stored, not deflated:
     PDFs are already compressed. */
  function zip(files, extra) {
    var enc = new TextEncoder();
    var list = files.map(function (f) { return { name: f.name, data: f.bytes }; });
    (extra || []).forEach(function (x) { list.push({ name: x.name, data: x.bytes || enc.encode(x.text || '') }); });
    var u = uniqueNames(list.map(function (x) { return x.name; })).names;
    list.forEach(function (x, i) { x.name = u[i]; });
    if (LE.zip) return LE.zip(list);
    throw new Error('Zip support is not loaded');
  }

  var api = {
    version: 1,
    ready: ready,
    cryptLib: cryptLib,
    protect: protect,
    unlock: unlock,
    encryptionInfo: encryptionInfo,
    passphrase: passphrase,
    strength: strength,
    parseTable: parseTable,
    parseDelimited: parseDelimited,
    fillText: fillText,
    tokens: tokensIn,
    sanitizeName: sanitizeName,
    uniqueNames: uniqueNames,
    toCsv: toCsv,
    autoMap: autoMap,
    analyzeTemplate: analyzeTemplate,
    validateRows: validateRows,
    mailMerge: mailMerge,
    previewRow: previewRow,
    passwordFor: passwordFor,
    watermark: watermark,
    watermarkCopies: watermarkCopies,
    splitPlan: splitPlan,
    splitApply: splitApply,
    nameGroups: nameGroups,
    pageLines: async function (input, pageIndex, opts) {
      await ready();
      var pdf = await pdfjsOpen(await toBytes(input), opts && opts.password);
      try { return await pageLinesOf(pdf, pageIndex || 0); } finally { pdf.destroy(); }
    },
    ruleFromClick: ruleFromClick,
    pageList: pageList,
    compress: compress,
    presets: PRESETS,
    textSignature: textSignature,
    zip: zip,
    lexContent: lexContent,
    _crypt: null
  };
  LE.pdfBulk = api;

})(typeof window !== "undefined" ? window : globalThis);

/* =====================================================================
   Part 2 — "Bulk & protect" in the PDF studio
   A panel (PS.panels.bulk) lists the jobs; each job opens a full-height workbench over the studio.
   ===================================================================== */
(function (global) {
  'use strict';

  var LE = global.LE || {};
  var PS = global.PS;
  var B = LE.pdfBulk;
  var d = global.document;
  if (!PS || !PS.panels || !PS.ui || !B) return;
  var S = PS.S;
  var ui = PS.ui, el = PS.el, esc = PS.esc, icon = PS.icon, $ = PS.$, $$ = PS.$$;

  function fmtBytes(n) { return global.IT && IT.formatBytes ? IT.formatBytes(n) : Math.round(n / 1024) + ' KB'; }
  function say(m, ms) { if (PS.say) PS.say(m, ms); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, ''); }
  function download(blob, name) { if (global.IT && IT.download) IT.download(blob, name); }
  function pdfBlob(bytes) { return new Blob([bytes], { type: 'application/pdf' }); }

  var EXTRA_ICONS = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M11 7h1M11 10h1M11 13h1M10.5 16h2v2h-2z"/>'
  };
  function ic(name) {
    if (EXTRA_ICONS[name]) return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + EXTRA_ICONS[name] + '</svg>';
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
  function note(text, cls) { return h('p', 'pb-note' + (cls ? ' ' + cls : ''), esc(text)); }
  function step(n, title, sub) {
    var s = h('section', 'pb-step');
    s.appendChild(h('h3', 'pb-step-title', '<span class="pb-step-n">' + n + '</span><span>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'));
    return s;
  }
  function cancelled(e) { return e && e.cancelled; }

  var JOBS = [
    { id: 'protect', icon: 'lock', title: 'Password-protect or unlock', sub: 'Lock a PDF with a password (AES-256), or remove one you know.' },
    { id: 'merge', icon: 'mail', title: 'Mail-merge', sub: 'One template and a spreadsheet: one PDF per person, each with its own password if you like.' },
    { id: 'split', icon: 'scissors', title: 'Split by text', sub: 'One long PDF into one file per employee, student or invoice.' },
    { id: 'watermark', icon: 'drop', title: 'Watermark copies', sub: 'A copy per recipient with their name on every page, so a leak can be traced.' },
    { id: 'compress', icon: 'gauge', title: 'Compress to a size', sub: 'Make a PDF small enough to email, keeping text sharp.' }
  ];

  /* ---------- the panel ---------- */

  PS.panels.bulk = {
    title: 'Bulk & protect', icon: 'lock', tone: 'jade', snap: 'half', noDoc: true,
    build: function (pane) {
      pane.appendChild(h('p', 'ps-note ps-lead', 'Weekly office jobs for confidential files.'));
      var list = h('div', 'pb-jobs');
      JOBS.forEach(function (j) {
        var b = button('pb-job', '<span class="pb-job-ic">' + ic(j.icon) + '</span><span class="pb-job-text"><strong>' + esc(j.title) + '</strong><small>' + esc(j.sub) + '</small></span>' + ic('chevron'), function () { openJob(j.id); }, { 'data-job': j.id });
        list.appendChild(b);
      });
      pane.appendChild(list);
      pane.appendChild(h('p', 'pb-private', ic('shield') + '<span>Files never leave this device.</span>'));
    }
  };

  /* rail button and start-screen link, added from here so the shared HTML stays untouched */
  function addEntryPoints() {
    var rail = $('#ps-rail');
    if (rail && !$('[data-panel="bulk"]', rail)) {
      var b = h('button', null, ic('lock') + '<span>Bulk</span>', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-panel': 'bulk', title: 'Bulk & protect', 'aria-label': 'Bulk and protect' });
      var exp = $('[data-panel="export"]', rail);
      rail.insertBefore(b, exp || null);
    }
    var starts = $('.ps-empty .ps-starts');
    if (starts && !$('.pb-entry')) {
      var link = button('pb-entry', ic('lock') + '<span><strong>Office jobs</strong> · protect, mail-merge, split, watermark, compress</span>' + ic('chevron'), function () { PS.openPanel('bulk'); }, { 'data-act-bulk': 'open' });
      starts.parentNode.insertBefore(link, starts.nextSibling);
    }
  }

  /* ---------- workbench ---------- */

  var W = null;
  var current = null;
  function workbench() {
    if (W) return W;
    W = h('section', 'pb-work', '', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pb-work-title', hidden: '' });
    W.innerHTML = '<header class="pb-head"><button class="ps-ib pb-close" type="button" aria-label="Back to the studio">' + ic('back') + '</button>' +
      '<div class="pb-head-text"><h2 id="pb-work-title"></h2><p class="pb-head-sub">' + ic('shield') + '<span>Runs on this device. Files never leave it.</span></p></div></header>' +
      '<div class="pb-body"><div class="pb-main"></div><aside class="pb-side" aria-label="Preview"></aside></div>' +
      '<footer class="pb-foot"><p class="pb-foot-msg" aria-live="polite"></p><div class="pb-foot-acts"></div></footer>';
    d.body.appendChild(W);
    $('.pb-close', W).addEventListener('click', closeJob);
    W.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !d.querySelector('dialog[open]')) { e.stopPropagation(); closeJob(); } });
    return W;
  }
  function openJob(id) {
    var w = workbench();
    if (current && current.destroy) current.destroy();
    var job = JOBS.filter(function (j) { return j.id === id; })[0];
    if (!job) return;
    $('#pb-work-title', w).textContent = job.title;
    var main = $('.pb-main', w), side = $('.pb-side', w), acts = $('.pb-foot-acts', w), msg = $('.pb-foot-msg', w);
    main.innerHTML = ''; side.innerHTML = ''; acts.innerHTML = ''; msg.textContent = '';
    w.setAttribute('data-job', id);
    w.hidden = false;
    d.body.classList.add('pb-open');
    if (PS.isPhone && PS.isPhone() && PS.setSheet) PS.setSheet('closed');
    current = RENDER[id]({ main: main, side: side, acts: acts, msg: msg, job: job });
    setTimeout(function () { var f = $('.pb-close', w); if (f) f.focus(); }, 30);
  }
  function closeJob() {
    if (!W) return;
    if (current && current.destroy) current.destroy();
    current = null;
    $$('input[type="password"], input[data-secret]', W).forEach(function (i) { i.value = ''; });
    $('.pb-main', W).innerHTML = '';
    $('.pb-side', W).innerHTML = '';
    W.hidden = true;
    d.body.classList.remove('pb-open');
    var b = d.querySelector('.pb-job[data-job="' + (W.getAttribute('data-job') || '') + '"]');
    if (b && b.offsetParent) b.focus();
  }
  PS.bulk = { open: openJob, close: closeJob, jobs: JOBS };

  /* primary action: one gold button in the footer */
  function setPrimary(ctx, label, onClick, disabled) {
    ctx.acts.innerHTML = '';
    var b = button('btn btn-gold pb-go', esc(label), onClick);
    b.disabled = !!disabled;
    ctx.acts.appendChild(b);
    return b;
  }
  function addSecondary(ctx, label, onClick) {
    var b = button('btn btn-ghost', esc(label), onClick);
    ctx.acts.insertBefore(b, ctx.acts.firstChild);
    return b;
  }

  /* progress with Cancel; returns { onProgress, isCancelled, end } */
  function runProgress(label) {
    var pr = PS.progress(label, true);
    return {
      onProgress: function (done, total, sub) { pr.set(done, total, sub); },
      isCancelled: function () { return pr.cancelled(); },
      end: function () { pr.end(); }
    };
  }

  /* ---------- sources ---------- */

  function openDocInfo() {
    var ids = Object.keys(S.docs || {});
    if (!S.pages || !S.pages.length) return null;
    var name = (PS.outName ? PS.outName() : 'document.pdf');
    var single = ids.length === 1 ? S.docs[ids[0]] : null;
    var plain = false;
    if (single) {
      var tools = PS.docToolOpts ? PS.docToolOpts() : {};
      var vals = S.formValues && S.formValues[single.id];
      plain = S.pages.length === single.pageCount && !Object.keys(tools).length && !(vals && Object.keys(vals).length) && S.pages.every(function (r, i) {
        return r.docId === single.id && r.pageIndex === i && !((r.rotation || 0) % 360) && !(r.scene && r.scene.layers && r.scene.layers.some(function (l) { return l.visible !== false; }));
      });
    }
    return { name: name, pages: S.pages.length, plain: plain, doc: single, encrypted: !!(single && single.encrypted) };
  }
  async function openDocBytes(info, pr) {
    if (info.plain && info.doc) return info.doc.bytes ? info.doc.bytes() : info.doc._bytes.slice(0);
    return PS.buildPdf({ progress: pr ? { set: function () {}, cancelled: function () { return false; } } : null });
  }

  /* A source picker: "the open document" or files chosen here. state.files = [{ name, file?, open? }] */
  function sourcePicker(ctx, opts) {
    opts = opts || {};
    var wrap = h('div', 'pb-source');
    var state = { files: [], onChange: opts.onChange || function () {} };
    var info = openDocInfo();
    var list = h('ul', 'pb-files');
    var row = h('div', 'pb-src-acts');
    function render() {
      list.innerHTML = '';
      state.files.forEach(function (f, i) {
        var li = h('li', 'pb-file', '<span class="pb-file-ic">' + ic('file') + '</span><span class="pb-file-name"></span><span class="pb-file-meta"></span>');
        $('.pb-file-name', li).textContent = f.name;
        $('.pb-file-meta', li).textContent = f.open ? 'Open in the studio · ' + plural(info.pages, 'page') : f.file ? fmtBytes(f.file.size) : '';
        var x = button('ps-ib pb-file-x', ic('close'), function () { state.files.splice(i, 1); render(); state.onChange(state); }, { 'aria-label': 'Remove ' + f.name });
        li.appendChild(x);
        list.appendChild(li);
      });
      list.hidden = !state.files.length;
      useOpen.hidden = !info || state.files.some(function (f) { return f.open; });
    }
    var choose = button('btn btn-sm', ic('filePlus') + '<span>' + (opts.multiple ? 'Choose PDFs' : 'Choose a PDF') + '</span>', function () {
      PS.pickFiles('.pdf,application/pdf', !!opts.multiple).then(function (files) {
        files = files.filter(function (f) { return /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name); });
        if (!files.length) return;
        if (!opts.multiple) state.files = [];
        files.forEach(function (f) { state.files.push({ name: f.name, file: f }); });
        render();
        state.onChange(state);
      });
    });
    var useOpen = button('btn btn-sm btn-ghost', ic('file') + '<span>Use the open document</span>', function () {
      if (!opts.multiple) state.files = [];
      state.files.unshift({ name: info.name, open: true });
      render();
      state.onChange(state);
    });
    row.appendChild(choose);
    row.appendChild(useOpen);
    wrap.appendChild(row);
    wrap.appendChild(list);
    if (info && opts.preferOpen !== false) state.files.push({ name: info.name, open: true });
    render();
    state.bytesOf = async function (f) {
      if (f.open) return openDocBytes(openDocInfo() || info);
      return new Uint8Array(await f.file.arrayBuffer());
    };
    state.el = wrap;
    state.refresh = render;
    return state;
  }

  /* ---------- page previews ---------- */

  async function renderPage(bytes, pageIndex, maxW, password) {
    await B.ready();
    var pdf = await global.pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, password: password || undefined }).promise;
    try {
      var n = pdf.numPages;
      var page = await pdf.getPage(Math.min(n, (pageIndex || 0) + 1));
      var base = page.getViewport({ scale: 1 });
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var scale = Math.min(2.5, (maxW || 420) / base.width);
      var vp = page.getViewport({ scale: scale * dpr });
      var c = d.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      c.style.width = Math.round(vp.width / dpr) + 'px';
      c.style.aspectRatio = vp.width + ' / ' + vp.height;
      var g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      page.cleanup();
      return { canvas: c, scale: scale, pages: n, width: base.width, height: base.height };
    } finally { pdf.destroy(); }
  }
  function previewBox(ctx, title) {
    ctx.side.innerHTML = '';
    var box = h('div', 'pb-preview');
    box.appendChild(h('div', 'pb-preview-head', '<strong>' + esc(title || 'Preview') + '</strong><span class="pb-preview-meta"></span>'));
    var stage = h('div', 'pb-preview-stage', '<p class="pb-preview-empty">The preview appears here.</p>');
    box.appendChild(stage);
    ctx.side.appendChild(box);
    return { box: box, stage: stage, meta: $('.pb-preview-meta', box) };
  }
  function width(elm) { return Math.max(220, Math.min(560, (elm.clientWidth || 420) - 2)); }

  /* ---------- password field with strength hint ---------- */

  function passwordField(label, opts) {
    opts = opts || {};
    var w = h('div', 'ps-field pb-pw');
    var id = 'pb-pw-' + Math.random().toString(36).slice(2, 7);
    w.innerHTML = '<label for="' + id + '">' + esc(label) + '</label><div class="pb-pw-row"><input class="input" id="' + id + '" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" data-secret="1"></div>';
    var input = $('input', w);
    var row = $('.pb-pw-row', w);
    var eye = button('ps-ib pb-eye', ic('eye'), function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.innerHTML = ic(show ? 'eyeOff' : 'eye');
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }, { 'aria-label': 'Show password' });
    row.appendChild(eye);
    if (opts.suggest) {
      var gen = button('btn btn-sm pb-suggest', ic('dice') + '<span>Suggest</span>', function () {
        input.value = B.passphrase({ words: 6 });
        input.type = 'text';
        eye.innerHTML = ic('eyeOff');
        input.dispatchEvent(new Event('input'));
        if (opts.onSuggest) opts.onSuggest(input.value);
      }, { title: 'Suggest a random six-word passphrase' });
      row.appendChild(gen);
    }
    if (opts.meter) {
      var meter = h('div', 'pb-meter', '<span class="pb-meter-bar"><i></i></span><span class="pb-meter-label"></span>');
      var hint = h('p', 'pb-note pb-meter-hint');
      w.appendChild(meter);
      w.appendChild(hint);
      var upd = function () {
        var s = B.strength(input.value);
        meter.setAttribute('data-score', input.value ? s.score : '');
        $('i', meter).style.width = input.value ? ((s.score + 1) * 20) + '%' : '0';
        $('.pb-meter-label', meter).textContent = input.value ? s.label : '';
        hint.textContent = input.value ? (s.hints[0] || (s.score >= 3 ? 'Good. Share it with the reader separately, not in the same email.' : '')) : 'Tip: a few random words are strong and easy to type.';
      };
      input.addEventListener('input', upd);
      upd();
    }
    w.input = input;
    return w;
  }

  /* ---------- results ---------- */

  function showResult(ctx, html, onDownload, label) {
    var r = h('div', 'pb-result', html);
    r.setAttribute('role', 'status');
    ctx.main.insertBefore(r, ctx.main.firstChild);
    ctx.main.scrollTop = 0;
    var go = setPrimary(ctx, label || 'Download', onDownload);
    go.innerHTML = ic('download') + '<span>' + esc(label || 'Download') + '</span>';
    return r;
  }
  function clearResult(ctx) { $$('.pb-result', ctx.main).forEach(function (r) { r.remove(); }); }
  function problemList(items, cls, limit) {
    var ul = h('ul', 'pb-problems ' + (cls || ''));
    items.slice(0, limit || 8).forEach(function (p) { ul.appendChild(h('li', null, esc(p.message || p))); });
    if (items.length > (limit || 8)) ul.appendChild(h('li', 'pb-more', esc('…and ' + (items.length - (limit || 8)) + ' more')));
    return ul;
  }
  function failMessage(e) {
    if (!e) return 'Something went wrong.';
    if (e.code === 'password') return e.message;
    return e.message || String(e);
  }
  function zipName(base, suffix) { return B.sanitizeName(baseName(base) + suffix, '.zip'); }

  /* =====================================================================
     D5 — protect / unlock
     ===================================================================== */
  function renderProtect(ctx) {
    var mode = 'add';
    var src = sourcePicker(ctx, { multiple: true, onChange: refresh });
    var s1 = step(1, 'Choose the PDF', 'one or several');
    s1.appendChild(src.el);
    var mseg = ui.seg([['add', 'Add a password'], ['remove', 'Remove a password']], mode, function (v) { mode = v; refresh(); });
    mseg.classList.add('pb-mode');
    var s2 = step(2, 'Password');
    var pw = passwordField('Password to open the PDF', { suggest: true, meter: true, onSuggest: function (v) { pw2.input.value = v; refresh(); } });
    var pw2 = passwordField('Type it again');
    var mismatch = note('', 'pb-bad');
    var cur = passwordField('Current password');
    s2.appendChild(pw);
    s2.appendChild(pw2);
    s2.appendChild(mismatch);
    s2.appendChild(cur);
    [pw, pw2, cur].forEach(function (f) { f.input.addEventListener('input', refresh); });

    var s3 = step(3, 'What readers may do', 'optional');
    var perms = { printing: 'high', copying: true, modifying: true, annotating: true, fillingForms: true };
    s3.appendChild(h('div', 'ps-label', 'Printing'));
    s3.appendChild(ui.seg([['high', 'Allowed'], ['low', 'Low quality'], ['none', 'Not allowed']], 'high', function (v) { perms.printing = v === 'none' ? false : v; }));
    s3.appendChild(ui.toggle('Copy text and images', true, function (v) { perms.copying = v; }));
    s3.appendChild(ui.toggle('Change the document', true, function (v) { perms.modifying = v; }));
    s3.appendChild(ui.toggle('Add comments', true, function (v) { perms.annotating = v; }));
    s3.appendChild(ui.toggle('Fill in forms', true, function (v) { perms.fillingForms = v; }));
    var algo = 'AES-256';
    s3.appendChild(h('div', 'ps-label', 'Encryption'));
    s3.appendChild(ui.seg([['AES-256', 'AES-256 (recommended)'], ['AES-128', 'AES-128 (older apps)']], algo, function (v) { algo = v; }));
    s3.appendChild(note('These permissions are requests. Most apps honour them, some ignore them. The open password is the real protection: without it nobody can read the file.'));

    var honest = h('div', 'pb-callout', '<strong>Keep the password safe.</strong> If it is lost, nobody can open the file again — not LocalEditor, not anyone. Send it to the reader separately, for example by text message, not in the same email as the PDF.');

    ctx.main.appendChild(mseg);
    ctx.main.appendChild(s1);
    ctx.main.appendChild(s2);
    ctx.main.appendChild(s3);
    ctx.main.appendChild(honest);
    previewBox(ctx, 'Before you send it').stage.innerHTML = '<ul class="pb-checklist"><li>Open the protected copy once with the password to check it.</li><li>Share the password another way than the file.</li><li>The original file on your device is not changed.</li></ul>';

    function refresh() {
      clearResult(ctx);
      var add = mode === 'add';
      pw.hidden = pw2.hidden = !add;
      s3.hidden = !add;
      honest.hidden = !add;
      cur.hidden = add;
      var n = src.files.length;
      var ok = n && (add ? pw.input.value && pw.input.value === pw2.input.value : cur.input.value !== '');
      mismatch.textContent = add && pw2.input.value && pw.input.value !== pw2.input.value ? 'The two passwords are different.' : '';
      setPrimary(ctx, add ? (n > 1 ? 'Protect ' + n + ' PDFs' : 'Protect PDF') : (n > 1 ? 'Unlock ' + n + ' PDFs' : 'Unlock PDF'), run, !ok);
      ctx.msg.textContent = !n ? 'Choose a PDF first.' : add && !pw.input.value ? 'Type a password or tap Suggest.' : '';
    }
    async function run() {
      var add = mode === 'add';
      var pr = runProgress(add ? 'Protecting' : 'Unlocking');
      var out = [], problems = [];
      try {
        for (var i = 0; i < src.files.length; i++) {
          var f = src.files[i];
          pr.onProgress(i, src.files.length, f.name);
          var bytes = await src.bytesOf(f);
          try {
            var res = add
              ? await B.protect(bytes, { userPassword: pw.input.value, permissions: perms, algorithm: algo, name: f.name })
              : await B.unlock(bytes, cur.input.value, { name: f.name });
            out.push({ name: B.sanitizeName(baseName(f.name) + (add ? '-protected' : '-unlocked')), bytes: res, from: f.name });
          } catch (e) {
            if (cancelled(e)) throw e;
            problems.push({ message: f.name + ': ' + failMessage(e) });
          }
          if (pr.isCancelled()) throw Object.assign(new Error('Cancelled'), { cancelled: true });
        }
        pr.end();
      } catch (e) {
        pr.end();
        if (cancelled(e)) { ctx.msg.textContent = 'Cancelled. Nothing was saved.'; return; }
        ctx.msg.textContent = failMessage(e);
        return;
      }
      if (!out.length) {
        ctx.msg.textContent = '';
        clearResult(ctx);
        var r = h('div', 'pb-result is-bad', '<strong>Nothing was saved.</strong>');
        r.appendChild(problemList(problems));
        ctx.main.insertBefore(r, ctx.main.firstChild);
        return;
      }
      var total = out.reduce(function (a, f) { return a + f.bytes.length; }, 0);
      var html = add
        ? '<strong>' + esc(plural(out.length, 'PDF')) + ' locked with ' + esc(algo) + '.</strong><span>Opening ' + (out.length === 1 ? 'it' : 'them') + ' needs the password. ' + (out.length === 1 ? esc(out[0].name) : 'A zip') + ' · ' + esc(fmtBytes(total)) + '</span>'
        : '<strong>' + esc(plural(out.length, 'PDF')) + ' unlocked.</strong><span>' + (out.length === 1 ? esc(out[0].name) : 'A zip') + ' opens without a password · ' + esc(fmtBytes(total)) + '</span>';
      var r2 = showResult(ctx, html, function () {
        if (out.length === 1) download(pdfBlob(out[0].bytes), out[0].name);
        else download(B.zip(out), add ? 'protected-pdfs.zip' : 'unlocked-pdfs.zip');
      }, out.length === 1 ? 'Download PDF' : 'Download zip');
      if (problems.length) r2.appendChild(problemList(problems, 'is-bad'));
      ctx.msg.textContent = '';
    }
    refresh();
    return { destroy: function () { pw.input.value = pw2.input.value = cur.input.value = ''; } };
  }

  /* =====================================================================
     D12 — mail-merge
     ===================================================================== */
  function studioTokens() {
    var keys = [];
    (S.pages || []).forEach(function (r) {
      ((r.scene && r.scene.layers) || []).forEach(function (l) { if (l.type === 'text' && l.visible !== false) B.tokens(l.text).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    });
    return keys;
  }
  function studioBuilder(mapping, dateOrder, stripTokens) {
    return async function (row) {
      var pages = S.pages.map(function (r) {
        if (!r.scene || !r.scene.layers) return r;
        var sc = PS.clone(r.scene);
        sc.layers = sc.layers.filter(function (l) { return !(stripTokens && l.type === 'text' && B.tokens(l.text).length); }).map(function (l) {
          if (l.type === 'text' && !stripTokens) l.text = B.fillText(l.text, row, { mapping: mapping, dateOrder: dateOrder });
          return l;
        });
        return Object.assign({}, r, { scene: sc });
      });
      return PS.buildPdf({ pages: pages });
    };
  }

  function renderMerge(ctx) {
    var st = { plan: null, studio: null, table: null, mapping: {}, targets: [], pattern: '', pw: { mode: 'none', column: '', pattern: '' }, flatten: true, wm: false, wmText: 'Confidential — issued to {{name}} — {{date}}', wmStyle: 'footer', dateOrder: 'dmy', row: 0, check: null };
    var pv = previewBox(ctx, 'Preview');

    /* 1. template */
    var s1 = step(1, 'Template', 'a PDF with form fields or {{column}} placeholders');
    var src = sourcePicker(ctx, { multiple: false, onChange: loadTemplate });
    s1.appendChild(src.el);
    var tInfo = h('div', 'pb-info');
    s1.appendChild(tInfo);
    s1.appendChild(h('details', 'pb-help', '<summary>How do I make a template?</summary><p>Type placeholders such as <code>{{name}}</code> or <code>{{net pay}}</code> where values should go — in a studio text box (Edit → Text), or in Word before saving as PDF. Use the column names from your spreadsheet. A PDF form works too: each field is matched to a column.</p><p>Supported: studio text boxes (font, size and alignment are kept); PDF form fields; placeholders typed as text in any PDF — the value starts where the placeholder starts, in a standard font close to the original. Long values are not wrapped, so preview a long row.</p>'));

    /* 2. data */
    var s2 = step(2, 'People', 'CSV, TSV, Excel or pasted rows');
    var dataRow = h('div', 'pb-src-acts');
    var chooseData = button('btn btn-sm', ic('filePlus') + '<span>Choose a spreadsheet</span>', function () {
      PS.pickFiles('.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,text/csv', false).then(function (f) { if (f[0]) loadData(f[0]); });
    });
    var pasteBtn = button('btn btn-sm btn-ghost', ic('copy') + '<span>Paste rows</span>', function () { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) $('textarea', pasteBox).focus(); });
    dataRow.appendChild(chooseData);
    dataRow.appendChild(pasteBtn);
    s2.appendChild(dataRow);
    var pasteBox = h('div', 'pb-paste', '<label class="ps-label" for="pb-paste-ta">Paste rows from a spreadsheet. The first row is the column names.</label><textarea id="pb-paste-ta" class="input pb-ta" rows="5" spellcheck="false" placeholder="Name,Employee ID,Net pay&#10;Priya Sharma,10001,3250.00"></textarea>');
    pasteBox.hidden = true;
    var useP = button('btn btn-sm', 'Use these rows', function () { loadData($('textarea', pasteBox).value); });
    pasteBox.appendChild(useP);
    s2.appendChild(pasteBox);
    var dInfo = h('div', 'pb-info');
    s2.appendChild(dInfo);

    /* 3. mapping */
    var s3 = step(3, 'Match columns');
    var mapBox = h('div', 'pb-map');
    s3.appendChild(mapBox);

    /* 4. names and options */
    var s4 = step(4, 'File names and options');
    var nameIn = ui.inputEl('text', '', { autocomplete: 'off', spellcheck: 'false' });
    var nameField = ui.field('File name pattern', nameIn, 'pb-merge-name');
    s4.appendChild(nameField);
    var chips = h('div', 'pb-chips');
    s4.appendChild(chips);
    var nameEx = note('');
    s4.appendChild(nameEx);
    nameIn.addEventListener('input', function () { st.pattern = nameIn.value; st.patternAuto = false; revalidate(); });
    var flatT = ui.toggle('Flatten form fields', true, function (v) { st.flatten = v; refreshPreview(); }, 'Values become part of the page and cannot be edited');
    s4.appendChild(flatT);

    s4.appendChild(h('div', 'ps-label', 'Password for each person'));
    var pwSeg = ui.seg([['none', 'None'], ['column', 'From a column'], ['pattern', 'From a pattern']], 'none', function (v) { st.pw.mode = v; pwOpts(); revalidate(); });
    s4.appendChild(pwSeg);
    var pwBox = h('div', 'pb-sub');
    s4.appendChild(pwBox);
    var wmT = ui.toggle('Add the person’s name as a watermark', false, function (v) { st.wm = v; wmBox.hidden = !v; refreshPreview(); });
    s4.appendChild(wmT);
    var wmBox = h('div', 'pb-sub');
    wmBox.hidden = true;
    var wmIn = ui.inputEl('text', st.wmText, { autocomplete: 'off' });
    wmIn.addEventListener('change', function () { st.wmText = wmIn.value; refreshPreview(); });
    wmBox.appendChild(ui.field('Watermark text', wmIn, 'pb-merge-wm'));
    wmBox.appendChild(ui.seg([['footer', 'Footer'], ['diagonal', 'Diagonal'], ['tiled', 'Tiled']], st.wmStyle, function (v) { st.wmStyle = v; refreshPreview(); }));
    s4.appendChild(wmBox);

    /* 5. check */
    var s5 = step(5, 'Check');
    var checkBox = h('div', 'pb-check');
    s5.appendChild(checkBox);

    [s1, s2, s3, s4, s5].forEach(function (s) { ctx.main.appendChild(s); });

    var nav = h('div', 'pb-rownav', '');
    var prevB = button('ps-ib', ic('left'), function () { setRow(st.row - 1); }, { 'aria-label': 'Previous row' });
    var rowLbl = h('span', 'pb-rownav-label', '');
    var nextB = button('ps-ib', ic('right'), function () { setRow(st.row + 1); }, { 'aria-label': 'Next row' });
    nav.appendChild(prevB); nav.appendChild(rowLbl); nav.appendChild(nextB);
    pv.box.insertBefore(nav, pv.stage);
    nav.hidden = true;

    function setRow(i) {
      if (!st.table) return;
      st.row = Math.max(0, Math.min(st.table.rows.length - 1, i));
      refreshPreview();
    }

    async function loadTemplate() {
      st.plan = null; st.studio = null;
      tInfo.innerHTML = '';
      var f = src.files[0];
      if (!f) { refreshAll(); return; }
      tInfo.innerHTML = '<p class="pb-note">Reading the template…</p>';
      try {
        if (f.open && studioTokens().length) {
          var keys = studioTokens();
          st.studio = { keys: keys };
          var base = await studioBuilder({}, 'dmy', true)({});
          var basePlan = await B.analyzeTemplate(base);
          st.studio.basePlaceholders = basePlan.slots.length > 0;
          basePlan.keys.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
          st.targets = keys.slice();
          tInfo.innerHTML = '';
          tInfo.appendChild(h('p', 'pb-ok', esc(plural(keys.length, 'placeholder')) + ' in your studio text boxes: ' + keys.map(function (k) { return '<code>{{' + esc(k) + '}}</code>'; }).join(' ')));
        } else {
          var bytes = await src.bytesOf(f);
          var plan = await B.analyzeTemplate(bytes, { name: f.name });
          st.plan = plan;
          st.targets = plan.keys.concat(plan.fields.map(function (x) { return x.name; }));
          tInfo.innerHTML = '';
          if (plan.kind === 'none') tInfo.appendChild(h('p', 'pb-bad', 'No form fields or {{placeholders}} were found in this PDF. See “How do I make a template?” below.'));
          else {
            var parts = [];
            if (plan.keys.length) parts.push(esc(plural(plan.keys.length, 'placeholder')) + ': ' + plan.keys.map(function (k) { return '<code>{{' + esc(k) + '}}</code>'; }).join(' '));
            if (plan.fields.length) parts.push(esc(plural(plan.fields.length, 'form field')) + ': ' + plan.fields.map(function (x) { return '<code>' + esc(x.name) + '</code>'; }).join(' '));
            tInfo.appendChild(h('p', 'pb-ok', parts.join('<br>')));
          }
          plan.notes.forEach(function (n) { tInfo.appendChild(note(n)); });
        }
      } catch (e) {
        tInfo.innerHTML = '';
        tInfo.appendChild(h('p', 'pb-bad', esc(failMessage(e))));
      }
      refreshAll();
    }

    async function loadData(input) {
      dInfo.innerHTML = '<p class="pb-note">Reading…</p>';
      try {
        var t = await B.parseTable(input, { sheet: st.sheet });
        st.table = t;
        st.dataInput = input;
        st.row = 0;
        dInfo.innerHTML = '';
        dInfo.appendChild(h('p', 'pb-ok', esc(plural(t.rows.length, 'row')) + ' · ' + esc(plural(t.columns.length, 'column')) + (typeof input === 'string' ? ' (pasted)' : ' from ' + esc(input.name))));
        if (t.sheets && t.sheets.length > 1) {
          var sel = ui.selectEl(t.sheets.map(function (s) { return [s, s]; }), t.sheet);
          sel.addEventListener('change', function () { st.sheet = sel.value; loadData(st.dataInput); });
          dInfo.appendChild(ui.field('Sheet', sel, 'pb-merge-sheet'));
        }
        t.warnings.forEach(function (w) { dInfo.appendChild(note(w)); });
        var tbl = h('div', 'pb-table-wrap');
        var html = '<table class="pb-table"><thead><tr>' + t.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        t.rows.slice(0, 3).forEach(function (r) { html += '<tr>' + t.columns.map(function (c) { return '<td>' + esc(r[c]) + '</td>'; }).join('') + '</tr>'; });
        tbl.innerHTML = html + '</tbody></table>';
        dInfo.appendChild(tbl);
        pasteBox.hidden = true;
      } catch (e) {
        st.table = null;
        dInfo.innerHTML = '';
        dInfo.appendChild(h('p', 'pb-bad', esc(failMessage(e))));
      }
      refreshAll();
    }

    function refreshAll() {
      var cols = st.table ? st.table.columns : [];
      st.mapping = B.autoMap(st.targets, cols);
      /* mapping UI */
      mapBox.innerHTML = '';
      if (!st.targets.length || !st.table) mapBox.appendChild(note(!st.targets.length ? 'Choose a template first.' : 'Add the people’s data first.'));
      else {
        st.targets.forEach(function (t) {
          var isField = st.plan && st.plan.fields.some(function (f) { return f.name === t; }) && st.plan.keys.indexOf(t) < 0;
          var sel = ui.selectEl([['', '(leave empty)']].concat(cols.map(function (c) { return [c, c]; })), st.mapping[t] || '');
          sel.setAttribute('data-target', t);
          sel.addEventListener('change', function () { st.mapping[t] = sel.value; revalidate(); });
          var row = h('div', 'pb-map-row');
          row.appendChild(h('span', 'pb-map-t', isField ? '<small>Field</small> ' + esc(t) : '<code>{{' + esc(t) + '}}</code>'));
          row.appendChild(h('span', 'pb-map-arrow', '←'));
          row.appendChild(sel);
          mapBox.appendChild(row);
        });
        var matched = st.targets.filter(function (t) { return st.mapping[t]; }).length;
        mapBox.appendChild(note(matched + ' of ' + st.targets.length + ' matched automatically. Change any that are wrong.'));
      }
      /* name pattern default */
      if (!st.pattern || st.patternAuto) {
        var nameCol = cols.filter(function (c) { return /name/i.test(c); })[0];
        st.pattern = nameCol ? '{{' + nameCol + '}}' : (cols[0] ? '{{' + cols[0] + '}}' : 'document-{{#}}');
        if (src.files[0]) st.pattern = baseName(src.files[0].name).replace(/[{}]/g, '').replace(/[-_ ]*template$/i, '') + ' - ' + st.pattern;
        st.patternAuto = true;
      }
      nameIn.value = st.pattern;
      chips.innerHTML = '';
      cols.slice(0, 12).forEach(function (c) {
        chips.appendChild(button('chip pb-chip', esc('{{' + c + '}}'), function () { insertAt(nameIn, '{{' + c + '}}'); st.pattern = nameIn.value; st.patternAuto = false; revalidate(); }));
      });
      flatT.hidden = !(st.plan && st.plan.fields.length);
      if (st.studio && st.plan === null) flatT.hidden = true;
      pwOpts();
      revalidate();
    }

    function insertAt(input, text) {
      var a = input.selectionStart == null ? input.value.length : input.selectionStart, b = input.selectionEnd == null ? a : input.selectionEnd;
      input.value = input.value.slice(0, a) + text + input.value.slice(b);
      input.focus();
      input.setSelectionRange(a + text.length, a + text.length);
    }

    function pwOpts() {
      pwBox.innerHTML = '';
      var cols = st.table ? st.table.columns : [];
      if (st.pw.mode === 'column') {
        var guess = cols.filter(function (c) { return /pass|pin|code|birth|dob/i.test(c); })[0] || cols[0] || '';
        if (!st.pw.column || cols.indexOf(st.pw.column) < 0) st.pw.column = guess;
        var sel = ui.selectEl(cols.map(function (c) { return [c, c]; }), st.pw.column);
        sel.addEventListener('change', function () { st.pw.column = sel.value; revalidate(); });
        pwBox.appendChild(ui.field('Column with each person’s password', sel, 'pb-merge-pwcol'));
      } else if (st.pw.mode === 'pattern') {
        var dob = cols.filter(function (c) { return /birth|dob/i.test(c); })[0];
        var id = cols.filter(function (c) { return /\bid\b|number|no\b/i.test(c); })[0];
        if (!st.pw.pattern) st.pw.pattern = dob ? '{{' + dob + '|DDMMYYYY}}' : id ? '{{' + id + '}}' : '';
        var inp = ui.inputEl('text', st.pw.pattern, { autocomplete: 'off', spellcheck: 'false' });
        inp.addEventListener('input', function () { st.pw.pattern = inp.value; revalidate(); });
        pwBox.appendChild(ui.field('Password pattern', inp, 'pb-merge-pwpat'));
        pwBox.appendChild(note('Use {{column}}. Dates can be reshaped: {{Date of birth|DDMMYYYY}}. Also |last4, |upper, |lower.'));
        var order = ui.seg([['dmy', 'Dates are day/month/year'], ['mdy', 'Month/day/year']], st.dateOrder, function (v) { st.dateOrder = v; revalidate(); });
        pwBox.appendChild(order);
      }
      if (st.pw.mode !== 'none') {
        pwBox.appendChild(h('div', 'pb-callout', '<strong>Each file opens only with its own password (AES-256).</strong> A date of birth or an ID is easy to guess for anyone who knows the person, so it stops casual opening, not a determined colleague. Passwords are never saved, logged or written to the summary.'));
        var reveal = h('p', 'pb-note pb-pwpeek');
        pwBox.appendChild(reveal);
        st.peek = reveal;
      } else st.peek = null;
    }

    function plannedOpts(forPreview) {
      return {
        mapping: st.mapping,
        namePattern: st.pattern,
        flatten: st.flatten,
        dateOrder: st.dateOrder,
        password: forPreview ? null : (st.pw.mode === 'none' ? null : { mode: st.pw.mode, column: st.pw.column, pattern: st.pw.pattern }),
        watermark: st.wm ? { text: st.wmText, style: st.wmStyle, size: st.wmStyle === 'footer' ? 9 : 0, opacity: st.wmStyle === 'footer' ? 0.7 : 0.16, color: '#8A1C1C' } : null,
        columns: st.table ? st.table.columns : []
      };
    }

    function revalidate() {
      checkBox.innerHTML = '';
      st.check = null;
      var ready = (st.plan && st.plan.kind !== 'none') || st.studio;
      if (!ready || !st.table) {
        setPrimary(ctx, 'Create PDFs', run, true);
        ctx.msg.textContent = !ready ? 'Choose a template with placeholders or form fields.' : 'Add the people’s data.';
        nav.hidden = true;
        return;
      }
      var o = plannedOpts(false);
      var check = B.validateRows(st.table.rows, { targets: st.targets, mapping: st.mapping, namePattern: st.pattern, password: o.password, dateOrder: st.dateOrder });
      st.check = check;
      var first = st.table.rows[0];
      nameEx.textContent = first ? 'Row 1 → ' + check.names[0] : '';
      if (st.peek && first) {
        var p = B.passwordFor(st.table.rows[st.row] || first, o.password, { dateOrder: st.dateOrder });
        st.peek.innerHTML = '';
        st.peek.appendChild(d.createTextNode('Row ' + (st.row + 1) + ' password: '));
        var masked = h('span', 'pb-mask', p ? '•'.repeat(Math.min(p.length, 16)) : '(empty)');
        st.peek.appendChild(masked);
        if (p) {
          var sb = button('btn-link pb-peek', 'Show', function () { masked.textContent = masked.textContent.charAt(0) === '•' ? p : '•'.repeat(Math.min(p.length, 16)); sb.textContent = sb.textContent === 'Show' ? 'Hide' : 'Show'; });
          st.peek.appendChild(sb);
        }
      }
      if (check.errors.length) {
        checkBox.appendChild(h('p', 'pb-bad', '<strong>' + esc(plural(check.errors.length, 'problem')) + ' to fix first</strong>'));
        checkBox.appendChild(problemList(check.errors, 'is-bad'));
      }
      if (check.warnings.length) {
        checkBox.appendChild(h('p', 'pb-warn', esc(plural(check.warnings.length, 'thing')) + ' to look at'));
        checkBox.appendChild(problemList(check.warnings, 'is-warn', 6));
      }
      if (!check.errors.length && !check.warnings.length) checkBox.appendChild(h('p', 'pb-ok', 'All ' + esc(plural(st.table.rows.length, 'row')) + ' look complete.'));
      var n = st.table.rows.length;
      setPrimary(ctx, 'Create ' + plural(n, 'PDF'), run, !check.ok);
      ctx.msg.textContent = check.ok ? (st.pw.mode !== 'none' ? 'Each file gets its own password.' : '') : 'Fix the problems above to continue.';
      nav.hidden = false;
      refreshPreview();
    }

    var pvSeq = 0;
    async function refreshPreview() {
      if (!st.table || !st.table.rows.length || !((st.plan && st.plan.kind !== 'none') || st.studio)) return;
      var my = ++pvSeq;
      rowLbl.textContent = 'Row ' + (st.row + 1) + ' of ' + st.table.rows.length;
      prevB.disabled = st.row <= 0;
      nextB.disabled = st.row >= st.table.rows.length - 1;
      try {
        var row = st.table.rows[st.row];
        var bytes;
        if (st.studio) {
          var o = plannedOpts(true);
          var r = await B.mailMerge(studioBuilder(st.mapping, st.dateOrder, false), [row], Object.assign(o, { targets: st.targets, analyzeEachRow: st.studio.basePlaceholders, namePattern: 'preview' }));
          bytes = r.files[0].bytes;
        } else bytes = await B.previewRow(st.plan, row, plannedOpts(true));
        if (my !== pvSeq) return;
        var rp = await renderPage(bytes, 0, width(pv.stage));
        if (my !== pvSeq) return;
        pv.stage.innerHTML = '';
        pv.stage.appendChild(rp.canvas);
        pv.meta.textContent = rp.pages > 1 ? 'page 1 of ' + rp.pages : '';
      } catch (e) {
        if (my !== pvSeq) return;
        pv.stage.innerHTML = '';
        pv.stage.appendChild(note('Preview failed: ' + failMessage(e), 'pb-bad'));
      }
    }

    async function run() {
      if (!st.check || !st.check.ok) return;
      clearResult(ctx);
      var pr = runProgress('Creating ' + plural(st.table.rows.length, 'PDF'));
      var res;
      try {
        var o = plannedOpts(false);
        o.onProgress = pr.onProgress;
        o.isCancelled = pr.isCancelled;
        if (st.studio) {
          o.targets = st.targets;
          o.analyzeEachRow = st.studio.basePlaceholders;
          res = await B.mailMerge(studioBuilder(st.mapping, st.dateOrder, false), st.table.rows, o);
        } else {
          var bytes = await src.bytesOf(src.files[0]);
          var plan = await B.analyzeTemplate(bytes);
          res = await B.mailMerge(plan, st.table.rows, o);
        }
        pr.end();
      } catch (e) {
        pr.end();
        if (cancelled(e)) { ctx.msg.textContent = 'Cancelled. Nothing was saved.'; return; }
        ctx.msg.textContent = failMessage(e);
        return;
      }
      var blob = B.zip(res.files, [{ name: 'summary.csv', text: res.summary }]);
      var html = '<strong>' + esc(plural(res.files.length, 'PDF')) + ' created.</strong><span>' +
        (res.report.protected ? esc(res.report.protected + ' with their own password. ') : '') +
        (res.report.watermarked ? esc(res.report.watermarked + ' watermarked. ') : '') +
        'A zip of ' + esc(fmtBytes(blob.size)) + '. summary.csv lists which file belongs to which row. It never contains passwords.</span>';
      var r = showResult(ctx, html, function () { download(blob, zipName(src.files[0] ? src.files[0].name : 'mail-merge', '-merged')); }, 'Download zip');
      if (res.report.warnings.length) r.appendChild(problemList(res.report.warnings, 'is-warn', 5));
      ctx.msg.textContent = '';
    }

    refreshAll();
    if (src.files.length) loadTemplate();
    return { destroy: function () { st.table = null; } };
  }

  /* =====================================================================
     D13 — split by text
     ===================================================================== */
  function renderSplit(ctx) {
    var st = { bytes: null, name: '', mode: 'text', rule: { mode: 'text', label: '', where: 'after' }, n: 1, level: 1, keepBlank: false, maxMB: 5, pattern: '{{value}}', page: 0, pages: 0, plan: null };
    var pv = previewBox(ctx, 'Click the value that changes');
    var s1 = step(1, 'The long PDF');
    var src = sourcePicker(ctx, { multiple: false, onChange: load });
    s1.appendChild(src.el);
    var s2 = step(2, 'Where does a new file start?');
    var mseg = ui.seg([['text', 'Text on the page'], ['every', 'Every N pages'], ['bookmarks', 'Bookmarks'], ['blank', 'Blank pages'], ['size', 'File size']], 'text', function (v) { st.mode = v; opts(); invalidate(); });
    mseg.classList.add('pb-seg-wrap');
    s2.appendChild(mseg);
    var optBox = h('div', 'pb-sub');
    s2.appendChild(optBox);
    var s3 = step(3, 'File names');
    var nameIn = ui.inputEl('text', st.pattern, { autocomplete: 'off', spellcheck: 'false' });
    s3.appendChild(ui.field('Name pattern', nameIn, 'pb-split-name'));
    s3.appendChild(note('{{value}} is the text found after the label (or the bookmark title), {{n}} the part number, {{file}} the original name, {{first}} and {{last}} the page numbers.'));
    nameIn.addEventListener('input', function () { st.pattern = nameIn.value; if (st.plan) { B.nameGroups(st.plan.groups, { namePattern: st.pattern, fileName: st.name }); drawGroups(); } });
    var s4 = step(4, 'Parts');
    var findBtn = button('btn btn-sm', ic('search') + '<span>Find the parts</span>', findParts);
    s4.appendChild(findBtn);
    var groupsBox = h('div', 'pb-groups');
    s4.appendChild(groupsBox);
    [s1, s2, s3, s4].forEach(function (s) { ctx.main.appendChild(s); });

    var nav = h('div', 'pb-rownav');
    var prevB = button('ps-ib', ic('left'), function () { showPage(st.page - 1); }, { 'aria-label': 'Previous page' });
    var lbl = h('span', 'pb-rownav-label');
    var nextB = button('ps-ib', ic('right'), function () { showPage(st.page + 1); }, { 'aria-label': 'Next page' });
    nav.appendChild(prevB); nav.appendChild(lbl); nav.appendChild(nextB);
    pv.box.insertBefore(nav, pv.stage);
    nav.hidden = true;

    function opts() {
      optBox.innerHTML = '';
      pv.box.hidden = st.mode !== 'text';
      ctx.side.classList.toggle('pb-side-off', st.mode !== 'text');
      if (st.mode === 'text') {
        var lab = ui.inputEl('text', st.rule.label, { autocomplete: 'off', spellcheck: 'false', placeholder: 'Employee ID:' });
        lab.addEventListener('input', function () { st.rule.label = lab.value; valueHint(); invalidate(); });
        optBox.appendChild(ui.field('Text just before the value', lab, 'pb-split-label'));
        optBox.appendChild(ui.seg([['after', 'Value is after it'], ['below', 'Value is below it']], st.rule.where, function (v) { st.rule.where = v; valueHint(); invalidate(); }));
        var vh = note('Tip: click the value (for example an employee ID) on the page preview and the label is filled in for you.');
        vh.classList.add('pb-valuehint');
        optBox.appendChild(vh);
        st.labelInput = lab;
        st.valueHint = vh;
        if (st.pattern === '{{file}}-{{n}}') { st.pattern = '{{value}}'; nameIn.value = st.pattern; }
      } else {
        if (st.pattern === '{{value}}' && st.mode !== 'bookmarks') { st.pattern = '{{file}}-{{n}}'; nameIn.value = st.pattern; }
        if (st.mode === 'bookmarks' && st.pattern === '{{file}}-{{n}}') { st.pattern = '{{value}}'; nameIn.value = st.pattern; }
      }
      if (st.mode === 'every') {
        var ni = ui.inputEl('number', st.n, { min: 1, max: 999, inputmode: 'numeric' });
        ni.addEventListener('input', function () { st.n = Math.max(1, +ni.value || 1); invalidate(); });
        optBox.appendChild(ui.field('Pages in each file', ni, 'pb-split-n'));
      } else if (st.mode === 'bookmarks') {
        optBox.appendChild(ui.seg([['1', 'Top-level bookmarks'], ['2', 'Second level']], String(st.level), function (v) { st.level = +v; invalidate(); }));
      } else if (st.mode === 'blank') {
        optBox.appendChild(note('Blank pages (no text and almost no ink) mark where a new file starts.'));
        optBox.appendChild(ui.toggle('Keep the blank pages', st.keepBlank, function (v) { st.keepBlank = v; invalidate(); }));
      } else if (st.mode === 'size') {
        var mi = ui.inputEl('number', st.maxMB, { min: 0.1, step: 0.5, inputmode: 'decimal' });
        mi.addEventListener('input', function () { st.maxMB = Math.max(0.1, +mi.value || 5); invalidate(); });
        optBox.appendChild(ui.field('Largest file (MB)', mi, 'pb-split-mb'));
      }
    }
    function valueHint() {
      if (!st.valueHint || !st.lines) return;
      var L = st.lines;
      var found = null;
      if (st.rule.label) {
        /* use the same matching as the split itself */
        found = matchOnLines(L, st.rule);
      }
      st.valueHint.textContent = !st.rule.label ? 'Tip: click the value (for example an employee ID) on the page preview and the label is filled in for you.' : found ? 'On this page the value is “' + found + '”.' : 'Not found on this page.';
    }
    function matchOnLines(L, rule) {
      var label = rule.label.replace(/\s+/g, ' ').trim().toLowerCase();
      for (var i = 0; i < L.lines.length; i++) {
        var t = L.lines[i].text;
        var at = t.toLowerCase().indexOf(label);
        if (at < 0) continue;
        if (rule.where === 'below') { var nx = L.lines[i + 1]; return nx ? nx.text.split(/\s{3,}/)[0].trim() : null; }
        var rest = t.slice(at + label.length).replace(/^[\s:#.\-–—]+/, '').split(/\s{3,}|\t/)[0].replace(/\s+/g, ' ').trim();
        if (rest) return rest;
      }
      return null;
    }
    function invalidate() {
      st.plan = null;
      groupsBox.innerHTML = '';
      setPrimary(ctx, 'Split', run, true);
      ctx.msg.textContent = st.bytes ? 'Find the parts, check them, then split.' : 'Choose a PDF first.';
    }
    async function load() {
      st.bytes = null; st.lines = null;
      invalidate();
      var f = src.files[0];
      if (!f) { pv.stage.innerHTML = '<p class="pb-preview-empty">The preview appears here.</p>'; nav.hidden = true; return; }
      try {
        st.bytes = await src.bytesOf(f);
        st.name = f.name;
        await showPage(0);
        invalidate();
      } catch (e) { ctx.msg.textContent = failMessage(e); }
    }
    var pseq = 0;
    async function showPage(i) {
      if (!st.bytes) return;
      var my = ++pseq;
      st.page = Math.max(0, i);
      try {
        var rp = await renderPage(st.bytes, st.page, width(pv.stage));
        var lines = await B.pageLines(st.bytes, Math.min(st.page, rp.pages - 1));
        if (my !== pseq) return;
        st.pages = rp.pages;
        st.page = Math.min(st.page, rp.pages - 1);
        st.lines = lines;
        nav.hidden = false;
        lbl.textContent = 'Page ' + (st.page + 1) + ' of ' + rp.pages;
        prevB.disabled = st.page <= 0;
        nextB.disabled = st.page >= rp.pages - 1;
        pv.stage.innerHTML = '';
        var wrap = h('div', 'pb-page');
        wrap.appendChild(rp.canvas);
        var layer = h('div', 'pb-hits');
        lines.lines.forEach(function (L, li) {
          L.items.forEach(function (it, ii) {
            var b = h('button', 'pb-hit', '', { type: 'button', 'aria-label': 'Use “' + it.str + '”', title: it.str });
            b.style.left = (it.x / lines.width * 100) + '%';
            b.style.top = ((it.y - it.size) / lines.height * 100) + '%';
            b.style.width = (Math.max(it.w, it.size) / lines.width * 100) + '%';
            b.style.height = (it.size * 1.25 / lines.height * 100) + '%';
            b.addEventListener('click', function () {
              var rule = B.ruleFromClick(lines, li, ii);
              if (!rule) return;
              if (st.mode !== 'text') { st.mode = 'text'; mseg.setValue('text'); opts(); }
              st.rule.label = rule.label;
              st.rule.where = rule.where;
              opts();
              $$('.pb-hit', layer).forEach(function (x) { x.classList.remove('is-on'); });
              b.classList.add('is-on');
              invalidate();
              valueHint();
            });
            layer.appendChild(b);
          });
        });
        wrap.appendChild(layer);
        pv.stage.appendChild(wrap);
        if (lines.empty) pv.stage.appendChild(note('This page has no text layer (it may be a scan), so there is nothing to click here.', 'pb-warn'));
        valueHint();
      } catch (e) {
        if (my !== pseq) return;
        if (e && e.code === 'password') { pv.stage.innerHTML = ''; pv.stage.appendChild(note('This PDF is locked. Unlock it first with “Password-protect or unlock”.', 'pb-bad')); }
        else { pv.stage.innerHTML = ''; pv.stage.appendChild(note('Could not show this page: ' + failMessage(e), 'pb-bad')); }
      }
    }
    function ruleNow() {
      if (st.mode === 'text') return { mode: 'text', label: st.rule.label, where: st.rule.where };
      if (st.mode === 'every') return { mode: 'every', n: st.n };
      if (st.mode === 'bookmarks') return { mode: 'bookmarks', level: st.level };
      if (st.mode === 'blank') return { mode: 'blank', keepBlank: st.keepBlank };
      return { mode: 'size', maxBytes: st.maxMB * 1024 * 1024 };
    }
    async function findParts() {
      if (!st.bytes) { ctx.msg.textContent = 'Choose a PDF first.'; return; }
      var pr = runProgress('Finding the parts');
      try {
        st.plan = await B.splitPlan(st.bytes, ruleNow(), { namePattern: st.pattern, fileName: st.name, onProgress: pr.onProgress, isCancelled: pr.isCancelled });
        pr.end();
      } catch (e) {
        pr.end();
        st.plan = null;
        if (!cancelled(e)) { groupsBox.innerHTML = ''; groupsBox.appendChild(note(failMessage(e), 'pb-bad')); }
        return;
      }
      drawGroups();
    }
    function drawGroups() {
      groupsBox.innerHTML = '';
      var plan = st.plan;
      if (!plan) return;
      plan.warnings.forEach(function (w) { groupsBox.appendChild(note(w, 'pb-warn')); });
      groupsBox.appendChild(h('p', 'pb-ok', esc(plural(plan.groups.length, 'file')) + ' from ' + esc(plural(plan.pageCount, 'page')) + '. Rename, join or split them before you continue.'));
      var ol = h('ol', 'pb-glist');
      plan.groups.forEach(function (g, i) {
        var li = h('li', 'pb-g' + (g.unmatched ? ' is-unmatched' : ''));
        var nm = ui.inputEl('text', g.name, { 'aria-label': 'File name for part ' + (i + 1), autocomplete: 'off', spellcheck: 'false' });
        nm.addEventListener('change', function () { g.name = B.sanitizeName(nm.value); g.nameEdited = true; nm.value = g.name; });
        li.appendChild(nm);
        var noTxt = g.pages.filter(function (p) { return plan.noText.indexOf(p) >= 0; });
        var meta = h('span', 'pb-g-meta', esc((g.pages.length === 1 ? 'Page ' : 'Pages ') + B.pageList(g.pages) + ' · ' + plural(g.pages.length, 'page')) + (noTxt.length ? ' · <span class="pb-warn">no text on ' + esc(B.pageList(noTxt)) + '</span>' : '') + (g.unmatched ? ' · <span class="pb-warn">before the first match</span>' : ''));
        li.appendChild(meta);
        var acts = h('span', 'pb-g-acts');
        if (i > 0) acts.appendChild(button('btn btn-sm btn-ghost', 'Join with previous', function () {
          var prev = plan.groups[i - 1];
          prev.pages = prev.pages.concat(g.pages);
          plan.groups.splice(i, 1);
          B.nameGroups(plan.groups, { namePattern: st.pattern, fileName: st.name });
          drawGroups();
        }));
        if (g.pages.length > 1) acts.appendChild(button('btn btn-sm btn-ghost', 'Split…', function () { splitGroup(g, i); }));
        li.appendChild(acts);
        ol.appendChild(li);
      });
      groupsBox.appendChild(ol);
      setPrimary(ctx, 'Split into ' + plural(plan.groups.length, 'file'), run, !plan.groups.length);
      ctx.msg.textContent = '';
    }
    async function splitGroup(g, i) {
      var wrap = h('div', 'ps-field', '<label for="pb-split-at">Start a new file at page</label><input class="input" id="pb-split-at" type="number" inputmode="numeric">');
      var inp = $('input', wrap);
      inp.min = g.pages[1] + 1; inp.max = g.pages[g.pages.length - 1] + 1; inp.value = g.pages[Math.floor(g.pages.length / 2)] + 1;
      var ok = await PS.dialog({ title: 'Split this part', body: wrap, ok: 'Split' });
      if (!ok) return;
      var at = (+inp.value || 0) - 1;
      var a = g.pages.filter(function (p) { return p < at; }), b = g.pages.filter(function (p) { return p >= at; });
      if (!a.length || !b.length) { say('Choose a page inside this part'); return; }
      g.pages = a;
      st.plan.groups.splice(i + 1, 0, { value: g.value, pages: b });
      B.nameGroups(st.plan.groups, { namePattern: st.pattern, fileName: st.name });
      drawGroups();
    }
    async function run() {
      if (!st.plan || !st.bytes) return;
      clearResult(ctx);
      var pr = runProgress('Splitting');
      var res;
      try {
        res = await B.splitApply(st.bytes, st.plan.groups, { onProgress: pr.onProgress, isCancelled: pr.isCancelled });
        pr.end();
      } catch (e) {
        pr.end();
        if (cancelled(e)) { ctx.msg.textContent = 'Cancelled. Nothing was saved.'; return; }
        ctx.msg.textContent = failMessage(e);
        return;
      }
      var blob = B.zip(res.files, [{ name: 'summary.csv', text: res.summary }]);
      showResult(ctx, '<strong>' + esc(plural(res.files.length, 'file')) + ' ready.</strong><span>A zip of ' + esc(fmtBytes(blob.size)) + ' with summary.csv (file, value, pages). The original PDF is not changed.</span>', function () {
        download(blob, zipName(st.name, '-split'));
      }, 'Download zip');
    }
    opts();
    invalidate();
    if (src.files.length) load();
    return {};
  }

  /* =====================================================================
     D7 — per-recipient watermarks
     ===================================================================== */
  function renderWatermark(ctx) {
    var st = { text: 'Confidential — issued to {{name}} — {{date}}', style: 'diagonal', size: 0, opacity: 0.16, color: '#B42318', trace: true, pattern: '{{file}} - {{name}}', people: [], table: null, nameCol: '' };
    var pv = previewBox(ctx, 'First copy');
    var s1 = step(1, 'The PDF to share');
    var src = sourcePicker(ctx, { multiple: false, onChange: refresh });
    s1.appendChild(src.el);
    var s2 = step(2, 'Recipients', 'one per line, or from a spreadsheet');
    var ta = h('textarea', 'input pb-ta', '', { rows: '5', spellcheck: 'false', 'aria-label': 'Recipients, one per line', placeholder: 'Priya Sharma\nDaniel Okafor' });
    ta.addEventListener('input', function () { st.table = null; refresh(); });
    s2.appendChild(ta);
    var sheetRow = h('div', 'pb-src-acts');
    sheetRow.appendChild(button('btn btn-sm btn-ghost', ic('filePlus') + '<span>From a spreadsheet</span>', function () {
      PS.pickFiles('.csv,.tsv,.txt,.xlsx,.xls,.ods', false).then(async function (f) {
        if (!f[0]) return;
        try {
          st.table = await B.parseTable(f[0]);
          st.nameCol = st.table.columns.filter(function (c) { return /name/i.test(c); })[0] || st.table.columns[0];
          ta.value = st.table.rows.map(function (r) { return r[st.nameCol]; }).filter(Boolean).join('\n');
          refresh();
        } catch (e) { say(failMessage(e)); }
      });
    }));
    s2.appendChild(sheetRow);
    var count = note('');
    s2.appendChild(count);
    var s3 = step(3, 'Watermark');
    var tIn = ui.inputEl('text', st.text, { autocomplete: 'off' });
    tIn.addEventListener('change', function () { st.text = tIn.value; refresh(); });
    s3.appendChild(ui.field('Text', tIn, 'pb-wm-text'));
    s3.appendChild(note('{{name}} is the recipient, {{date}} today, {{id}} the copy number.'));
    s3.appendChild(ui.seg([['diagonal', 'Diagonal'], ['tiled', 'Tiled'], ['footer', 'Footer']], st.style, function (v) { st.style = v; refresh(); }));
    s3.appendChild(ui.slider('Opacity', 5, 100, 1, Math.round(st.opacity * 100), function (v) { return v + '%'; }, function (v) { st.opacity = v / 100; refreshSoon(); }));
    s3.appendChild(ui.slider('Size', 0, 96, 1, st.size, function (v) { return v ? v + ' pt' : 'Auto'; }, function (v) { st.size = v; refreshSoon(); }));
    s3.appendChild(ui.swatches(['#B42318', '#8A1C1C', '#5E5967', '#16131C', '#1D4ED8', '#1B7F54'], st.color, function (c) { st.color = c; refreshSoon(); }, false, { label: 'Watermark colour' }));
    var s4 = step(4, 'Tracing and names');
    s4.appendChild(ui.toggle('Add a hidden copy number', true, function (v) { st.trace = v; refreshSoon(); }, 'A short code in the file’s properties and in tiny print on every page, listed in summary.csv'));
    var nIn = ui.inputEl('text', st.pattern, { autocomplete: 'off', spellcheck: 'false' });
    nIn.addEventListener('input', function () { st.pattern = nIn.value; });
    s4.appendChild(ui.field('File name pattern', nIn, 'pb-wm-name'));
    var honest = h('div', 'pb-callout', '<strong>A watermark deters and traces; it does not prevent.</strong> Someone determined can crop, cover or retype the content. The copy number helps you find out whose copy leaked.');
    [s1, s2, s3, s4].forEach(function (s) { ctx.main.appendChild(s); });
    ctx.main.appendChild(honest);

    function people() { return ta.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean); }
    var tmr = null;
    function refreshSoon() { clearTimeout(tmr); tmr = setTimeout(refresh, 250); }
    var seq = 0;
    async function refresh() {
      clearResult(ctx);
      var list = people();
      count.textContent = list.length ? plural(list.length, 'copy', 'copies') + ' will be made.' : '';
      var ok = src.files.length && list.length;
      setPrimary(ctx, list.length ? 'Create ' + plural(list.length, 'copy', 'copies') : 'Create copies', run, !ok);
      ctx.msg.textContent = !src.files.length ? 'Choose a PDF first.' : !list.length ? 'Add at least one recipient.' : '';
      if (!src.files.length) return;
      var my = ++seq;
      try {
        var bytes = await src.bytesOf(src.files[0]);
        var who = list[0] || 'Recipient name';
        var text = B.fillText(st.text, { name: who }, { extra: { date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), id: 'LE-XXXX-XXXX' } });
        var out = await B.watermark(bytes, text, { style: st.style, size: st.size, opacity: st.opacity, color: st.color, traceId: st.trace ? 'LE-XXXX-XXXX' : '', traceMark: st.trace });
        if (my !== seq) return;
        var rp = await renderPage(out, 0, width(pv.stage));
        if (my !== seq) return;
        pv.stage.innerHTML = '';
        pv.stage.appendChild(rp.canvas);
        pv.meta.textContent = who;
      } catch (e) {
        if (my !== seq) return;
        pv.stage.innerHTML = '';
        pv.stage.appendChild(note(failMessage(e), 'pb-bad'));
      }
    }
    async function run() {
      var list = people();
      clearResult(ctx);
      var pr = runProgress('Creating ' + plural(list.length, 'copy', 'copies'));
      var res;
      try {
        var bytes = await src.bytesOf(src.files[0]);
        var rows = st.table && st.nameCol ? st.table.rows.filter(function (r) { return list.indexOf(String(r[st.nameCol]).trim()) >= 0; }) : null;
        res = await B.watermarkCopies(bytes, rows && rows.length === list.length ? rows : list, {
          nameColumn: rows && rows.length === list.length ? st.nameCol : 'name', text: st.text, style: st.style, size: st.size, opacity: st.opacity, color: st.color, trace: st.trace,
          namePattern: st.pattern, fileName: src.files[0].name, onProgress: pr.onProgress, isCancelled: pr.isCancelled
        });
        pr.end();
      } catch (e) {
        pr.end();
        if (cancelled(e)) { ctx.msg.textContent = 'Cancelled. Nothing was saved.'; return; }
        ctx.msg.textContent = failMessage(e);
        return;
      }
      var blob = B.zip(res.files, [{ name: 'summary.csv', text: res.summary }]);
      showResult(ctx, '<strong>' + esc(plural(res.files.length, 'copy', 'copies')) + ' ready.</strong><span>Each has the recipient’s name on every page' + (st.trace ? ' and its own copy number' : '') + '. summary.csv maps recipient → file' + (st.trace ? ' → copy number' : '') + '. Keep it somewhere safe. Zip: ' + esc(fmtBytes(blob.size)) + '.</span>', function () {
        download(blob, zipName(src.files[0].name, '-copies'));
      }, 'Download zip');
    }
    refresh();
    return { destroy: function () { clearTimeout(tmr); } };
  }

  /* =====================================================================
     D8 — compress to a size
     ===================================================================== */
  function renderCompress(ctx) {
    var st = { preset: '2mb', customMB: 1, strip: false };
    var s1 = step(1, 'Choose the PDF', 'one or several');
    var src = sourcePicker(ctx, { multiple: true, onChange: refresh });
    s1.appendChild(src.el);
    var s2 = step(2, 'Target size');
    var seg = ui.seg([['email', 'Email (10 MB)'], ['2mb', 'Under 2 MB'], ['500kb', 'Under 500 KB'], ['custom', 'Custom']], st.preset, function (v) { st.preset = v; customBox.hidden = v !== 'custom'; refresh(); });
    seg.classList.add('pb-seg-wrap');
    s2.appendChild(seg);
    var customBox = h('div', 'pb-sub');
    var ci = ui.inputEl('number', st.customMB, { min: 0.05, step: 0.1, inputmode: 'decimal' });
    ci.addEventListener('input', function () { st.customMB = Math.max(0.05, +ci.value || 1); });
    customBox.appendChild(ui.field('Largest size (MB)', ci, 'pb-comp-mb'));
    customBox.hidden = true;
    s2.appendChild(customBox);
    s2.appendChild(ui.toggle('Remove document details', false, function (v) { st.strip = v; }, 'Author, software, dates and other properties'));
    s2.appendChild(note('First the file is tidied without any change in quality. Then photos and scans are made lighter, one step at a time. Text and drawings stay sharp and selectable. Pages are only turned into pictures if you choose that.'));
    ctx.main.appendChild(s1);
    ctx.main.appendChild(s2);
    var pvx = previewBox(ctx, 'What happens');
    pvx.stage.innerHTML = '<ol class="pb-checklist"><li>Tidy: duplicates, unused parts and thumbnails removed.</li><li>Photos above the target resolution are resized and saved as JPEG.</li><li>CMYK, masked, JPEG 2000 and scan images are left exactly as they are.</li><li>If the size is still too big, you decide whether pages may become pictures.</li></ol>';

    function target() { return st.preset === 'custom' ? st.customMB * 1024 * 1024 : B.presets[st.preset].targetBytes; }
    function refresh() {
      clearResult(ctx);
      var n = src.files.length;
      setPrimary(ctx, n > 1 ? 'Compress ' + n + ' PDFs' : 'Compress', function () { run(false); }, !n);
      ctx.msg.textContent = n ? '' : 'Choose a PDF first.';
    }
    async function run(allowRaster, only) {
      clearResult(ctx);
      var pr = runProgress(allowRaster ? 'Turning pages into pictures' : 'Compressing');
      var out = [], rows = [];
      var files = only || src.files;
      try {
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var bytes = await src.bytesOf(f);
          var res = await B.compress(bytes, { targetBytes: target(), stripMetadata: st.strip, allowRaster: allowRaster, name: f.name, onProgress: function (dn, t, sub) { pr.onProgress(dn, t, (files.length > 1 ? f.name + ' · ' : '') + (sub || '')); }, isCancelled: pr.isCancelled });
          out.push({ name: B.sanitizeName(baseName(f.name) + '-compressed'), bytes: res.bytes, report: res.report, file: f });
        }
        pr.end();
      } catch (e) {
        pr.end();
        if (cancelled(e)) { ctx.msg.textContent = 'Cancelled. Nothing was saved.'; return; }
        ctx.msg.textContent = failMessage(e);
        return;
      }
      var html = '';
      var unreachable = [];
      out.forEach(function (o) {
        var r = o.report;
        var saved = r.originalBytes ? Math.round((1 - r.bytes / r.originalBytes) * 100) : 0;
        var lines = [];
        lines.push(fmtBytes(r.originalBytes) + ' → ' + fmtBytes(r.bytes) + (saved > 0 ? ' (' + saved + '% smaller)' : ' (no smaller)'));
        if (r.images && r.images.recompressed) lines.push(plural(r.images.recompressed, 'image') + ' made lighter' + (r.level && !r.rasterized ? ' (' + r.level.dpi + ' dpi)' : '') + '.');
        var sk = r.images && r.images.skipped ? Object.keys(r.images.skipped) : [];
        if (sk.length) lines.push('Left exactly as they were: ' + sk.map(function (k) { return k + ' (' + r.images.skipped[k] + ')'; }).join(', ') + '.');
        if (r.lossless && (r.lossless.duplicatesMerged || r.lossless.unusedRemoved)) lines.push('Tidied: ' + (r.lossless.duplicatesMerged ? plural(r.lossless.duplicatesMerged, 'duplicate') + ' merged' : '') + (r.lossless.duplicatesMerged && r.lossless.unusedRemoved ? ', ' : '') + (r.lossless.unusedRemoved ? plural(r.lossless.unusedRemoved, 'unused part') + ' removed' : '') + '.');
        lines.push(r.textSelectable ? 'Text is still selectable.' : 'Pages are now pictures: text cannot be selected or searched.');
        r.notes.forEach(function (n) { if (!/already tidy/.test(n) || lines.length < 3) lines.push(n); });
        if (!r.reached) unreachable.push(o);
        html += '<div class="pb-res-file"><strong>' + esc(o.name) + '</strong><span>' + lines.map(esc).join('<br>') + '</span></div>';
      });
      var head = unreachable.length ? '<strong>' + (unreachable.length === out.length && out.length === 1 ? 'The target could not be reached with text kept.' : esc(plural(unreachable.length, 'file')) + ' could not reach the target with text kept.') + '</strong>' : '<strong>' + (out.length === 1 ? 'Done.' : esc(plural(out.length, 'file')) + ' compressed.') + '</strong>';
      var res = showResult(ctx, head + html, function () {
        if (out.length === 1) download(pdfBlob(out[0].bytes), out[0].name);
        else download(B.zip(out), 'compressed-pdfs.zip');
      }, out.length === 1 ? 'Download ' + fmtBytes(out[0].bytes.length) + ' PDF' : 'Download zip');
      if (unreachable.length && !allowRaster) {
        var rb = button('btn btn-sm', 'Turn pages into pictures to reach ' + fmtBytes(target()), function () { run(true, unreachable.map(function (o) { return o.file; })); });
        res.appendChild(note('This makes the file smaller, but text can no longer be selected, searched or read aloud, and links stop working.'));
        res.appendChild(rb);
      }
    }
    refresh();
    return {};
  }

  var RENDER = { protect: renderProtect, merge: renderMerge, split: renderSplit, watermark: renderWatermark, compress: renderCompress };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(addEntryPoints, 0); });
  else setTimeout(addEntryPoints, 0);
})(typeof window !== 'undefined' ? window : globalThis);
