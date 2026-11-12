/* LocalEditor: business documents in the PDF studio (docs/ROADMAP.md D17, D18).
   Part 1 is LE.pdfDocs: exact money arithmetic, numbering, the on-device store, invoice/quote/receipt PDFs
   (real text through LE.pdfFlow) and table extraction from PDF text positions. Part 2 is the studio UI.
   This is a document maker, not accounting software. Nothing leaves the device. */
(function (global) {
  'use strict';

  var LE = global.LE = global.LE || {};
  var d = global.document;

  function asset(path) {
    var root = '';
    try { root = d.documentElement.getAttribute('data-root') || ''; } catch (e) { root = ''; }
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    return root + path;
  }
  function lazy(path) { return LE.lazy ? Promise.resolve(LE.lazy(asset(path))) : Promise.reject(new Error('loader missing')); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max || 500); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* =====================================================================
     Money: integers only. Amounts are minor units (cents, paise ...), quantities are thousandths,
     rates and percentages are basis points (1 % = 100). Rounding is half away from zero, at the end of
     each step stated below, so the printed figures always add up.
     ===================================================================== */

  var MAX_MINOR = 1e13;        /* 100 billion in a 2-decimal currency */
  var MAX_QTY = 1e9;           /* 1,000,000.000 units */

  function roundDiv(n, dv) {
    /* n / dv rounded half away from zero; n and dv are safe integers, dv > 0 */
    var neg = n < 0;
    if (neg) n = -n;
    var q = Math.floor(n / dv);
    var r = n - q * dv;
    if (r * 2 >= dv) q += 1;
    return neg ? -q : q;
  }
  /* exact round(a * b / dv), half away from zero, for safe integers a, b and 0 < dv \u2264 1e7.
     a × b is held in base-1e7 limbs so it never leaves the exactly representable range. */
  function mulDiv(a, b, dv) {
    var neg = (a < 0) !== (b < 0);
    a = Math.abs(a); b = Math.abs(b);
    if (!a || !b) return 0;
    var B = 1e7;
    function limbs(n) { var out = []; while (n > 0) { out.push(n % B); n = Math.floor(n / B); } return out; }
    var x = limbs(a), y = limbs(b), p = [];
    for (var i = 0; i < x.length; i++) {
      var carry = 0;
      for (var j = 0; j < y.length || carry; j++) {
        var cur = (p[i + j] || 0) + x[i] * (y[j] || 0) + carry; /* \u2264 1e14 + 1e7: exact */
        p[i + j] = cur % B;
        carry = Math.floor(cur / B);
      }
    }
    /* long division by dv, most significant limb first */
    var q = [], r = 0;
    for (var k = p.length - 1; k >= 0; k--) {
      var v = r * B + (p[k] || 0);       /* r < dv \u2264 1e7, so v < 1e14 */
      q[k] = Math.floor(v / dv);
      r = v - q[k] * dv;
    }
    var res = 0;
    for (var m = q.length - 1; m >= 0; m--) {
      res = res * B + q[m];
      if (res > 9e15) throw new Error('Amount too large');
    }
    if (r * 2 >= dv) res += 1;
    return neg ? -res : res;
  }

  /* "1,234.50" → minor units. sep is the decimal separator the person chose ('.' or ','). Returns NaN when unclear. */
  function parseAmount(text, decimals, sep) {
    decimals = decimals == null ? 2 : decimals;
    sep = sep || '.';
    var s = String(text == null ? '' : text).trim();
    if (!s) return 0;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
    s = s.replace(/[()\-\s\u00A0\u202F']/g, '').replace(/^[^\d.,]+|[^\d.,]+$/g, '');
    var group = sep === '.' ? ',' : '.';
    s = s.split(group).join('');
    if (sep === ',') s = s.replace(',', '.');
    if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return NaN;
    var parts = s.split('.');
    var whole = parts[0] || '0';
    var frac = parts[1] || '';
    if (frac.length > decimals) {
      /* round the extra digits half away from zero */
      var extra = frac.slice(decimals);
      frac = frac.slice(0, decimals);
      var up = extra.charAt(0) >= '5';
      var n0 = whole.replace(/^0+(?=\d)/, '') + frac;
      var v0 = Number(n0 || '0') + (up ? 1 : 0);
      if (!isFinite(v0) || v0 > MAX_MINOR) return NaN;
      return neg ? -v0 : v0;
    }
    while (frac.length < decimals) frac += '0';
    var v = Number((whole + frac).replace(/^0+(?=\d)/, ''));
    if (!isFinite(v) || v > MAX_MINOR) return NaN;
    return neg ? -v : v;
  }
  /* "2.5" → 2500 thousandths */
  function parseQty(text) {
    var s = String(text == null ? '' : text).trim().replace(/[\s\u00A0']/g, '').replace(',', '.');
    if (!s) return 0;
    if (!/^-?\d*(\.\d*)?$/.test(s) || s === '.' || s === '-') return NaN;
    var neg = s.charAt(0) === '-';
    s = s.replace('-', '');
    var parts = s.split('.');
    var frac = (parts[1] || '');
    var extra = frac.slice(3);
    frac = (frac.slice(0, 3) + '000').slice(0, 3);
    var v = Number((parts[0] || '0') + frac) + (extra && extra.charAt(0) >= '5' ? 1 : 0);
    if (!isFinite(v) || v > MAX_QTY) return NaN;
    return neg ? -v : v;
  }
  /* "18" or "12.5" percent → basis points */
  function parseRate(text) {
    var s = String(text == null ? '' : text).trim().replace('%', '').replace(',', '.');
    if (!s) return 0;
    if (!/^\d*(\.\d*)?$/.test(s) || s === '.') return NaN;
    var parts = s.split('.');
    var frac = ((parts[1] || '') + '00').slice(0, 2);
    var v = Number((parts[0] || '0') + frac);
    return v > 100000 ? NaN : v; /* up to 1000 % */
  }

  /* Formats minor units for people: currency { code, symbol, place: 'before'|'after', decimals, style } */
  var STYLES = {
    'en': { group: ',', dec: '.', lakh: false },
    'eu': { group: '.', dec: ',', lakh: false },
    'space': { group: '\u202F', dec: ',', lakh: false },
    'ch': { group: '’', dec: '.', lakh: false },
    'in': { group: ',', dec: '.', lakh: true }
  };
  function formatMoney(minor, cur, opts) {
    cur = cur || {};
    opts = opts || {};
    var decimals = cur.decimals == null ? 2 : cur.decimals;
    var st = STYLES[cur.style] || STYLES.en;
    var neg = minor < 0;
    var n = Math.abs(minor);
    var div = Math.pow(10, decimals);
    var whole = String(Math.floor(n / div));
    var frac = decimals ? String(n % div) : '';
    while (frac.length < decimals) frac = '0' + frac;
    var g;
    if (st.lakh && whole.length > 3) {
      var last3 = whole.slice(-3), rest = whole.slice(0, -3);
      g = rest.replace(/\B(?=(\d{2})+(?!\d))/g, st.group) + st.group + last3;
    } else g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, st.group);
    var num = g + (decimals ? st.dec + frac : '');
    if (opts.plain) return (neg ? '-' : '') + num;
    var sym = cur.symbol != null && cur.symbol !== '' ? cur.symbol : (cur.code || '');
    var out;
    if (!sym) out = num;
    else if (cur.place === 'after') out = num + (cur.space === false ? '' : '\u00A0') + sym;
    else out = sym + (cur.space ? '\u00A0' : '') + num;
    return neg ? '\u2212' + out : out;
  }
  function formatQty(milli) {
    var neg = milli < 0;
    milli = Math.abs(milli);
    var w = Math.floor(milli / 1000), f = milli % 1000;
    var s = String(w) + (f ? '.' + String(f + 1000).slice(1).replace(/0+$/, '') : '');
    return (neg ? '-' : '') + s;
  }
  function formatRate(bp) { var w = Math.floor(bp / 100), f = bp % 100; return w + (f ? '.' + String(f + 100).slice(1).replace(/0+$/, '') : '') + '%'; }

  /* Splits `total` minor units across `weights` so the parts add up exactly (largest remainder). */
  function allocate(total, weights) {
    var sum = weights.reduce(function (a, b) { return a + Math.abs(b); }, 0);
    if (!sum) return weights.map(function () { return 0; });
    var sign = total < 0 ? -1 : 1;
    var t = Math.abs(total);
    var raw = weights.map(function (w) { return mulDiv(t, Math.abs(w), 1) / sum; });
    var base = raw.map(Math.floor);
    var left = t - base.reduce(function (a, b) { return a + b; }, 0);
    var order = raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; }).sort(function (a, b) { return b.f - a.f || a.i - b.i; });
    for (var k = 0; k < left; k++) base[order[k % order.length].i] += 1;
    return base.map(function (b) { return b * sign; });
  }

  /* TAX PRESETS: labels only. They carry no rates and no advice. */
  var TAX_PRESETS = [
    { id: 'none', label: 'No tax', regLabel: '' },
    { id: 'vat', label: 'VAT', regLabel: 'VAT no.' },
    { id: 'gst-split', label: 'GST', split: ['CGST', 'SGST'], regLabel: 'GSTIN' },
    { id: 'gst-igst', label: 'IGST', regLabel: 'GSTIN' },
    { id: 'gst', label: 'GST', regLabel: 'GST no.' },
    { id: 'sales', label: 'Sales tax', regLabel: 'Tax ID' },
    { id: 'custom', label: 'Tax', regLabel: 'Tax ID' }
  ];

  /* Computes every figure of a document.
     Rules (also shown in the UI):
       1. line amount = quantity × unit price, rounded to the minor unit;
       2. line discount (percent or amount) comes off that line, the percent rounded to the minor unit;
       3. a document discount comes off the subtotal and is shared across tax rates in proportion (exact, largest remainder);
       4. tax is worked out once per rate on the taxable amount for that rate, rounded half away from zero;
          a split tax (e.g. CGST + SGST) rounds each half separately and the total is their sum;
       5. total = taxable + tax (prices exclusive of tax) or taxable (prices inclusive of tax, tax shown as included);
       6. balance due = total \u2212 amount paid. */
  function totals(doc) {
    var cur = doc.currency || {};
    var dec = cur.decimals == null ? 2 : cur.decimals;
    var sep = (STYLES[cur.style] || STYLES.en).dec;
    var tax = doc.tax || { mode: 'none' };
    var preset = TAX_PRESETS.filter(function (p) { return p.id === tax.preset; })[0] || TAX_PRESETS[0];
    var errors = [];
    var lines = (doc.items || []).map(function (it, i) {
      var q = parseQty(it.qty == null || it.qty === '' ? '1' : it.qty);
      var p = parseAmount(it.price, dec, sep);
      if (isNaN(q)) errors.push({ line: i, field: 'qty' });
      if (isNaN(p)) errors.push({ line: i, field: 'price' });
      q = isNaN(q) ? 0 : q; p = isNaN(p) ? 0 : p;
      var gross;
      try { gross = mulDiv(q, p, 1000); } catch (e) { errors.push({ line: i, field: 'price', reason: 'too large' }); gross = 0; }
      var disc = 0;
      var dtext = String(it.discount == null ? '' : it.discount).trim();
      if (dtext) {
        if (/%$/.test(dtext)) { var dr = parseRate(dtext); if (isNaN(dr)) errors.push({ line: i, field: 'discount' }); else disc = mulDiv(gross, dr, 10000); }
        else { var da = parseAmount(dtext, dec, sep); if (isNaN(da)) errors.push({ line: i, field: 'discount' }); else disc = da; }
      }
      if (Math.abs(disc) > Math.abs(gross)) disc = gross;
      var rate = 0;
      if (tax.mode === 'line') { rate = parseRate(it.tax); if (isNaN(rate)) { errors.push({ line: i, field: 'tax' }); rate = 0; } }
      else if (tax.mode === 'doc') { rate = parseRate(tax.rate); if (isNaN(rate)) rate = 0; }
      return { index: i, qty: q, price: p, gross: gross, discount: disc, net: gross - disc, rate: rate };
    });
    var subtotal = lines.reduce(function (a, l) { return a + l.net; }, 0);
    var lineDiscounts = lines.reduce(function (a, l) { return a + l.discount; }, 0);
    /* document discount */
    var docDisc = 0;
    var dd = String(doc.discount == null ? '' : doc.discount).trim();
    if (dd) {
      if (/%$/.test(dd)) { var r0 = parseRate(dd); docDisc = isNaN(r0) ? 0 : mulDiv(subtotal, r0, 10000); if (isNaN(r0)) errors.push({ field: 'discount' }); }
      else { var a0 = parseAmount(dd, dec, sep); docDisc = isNaN(a0) ? 0 : a0; if (isNaN(a0)) errors.push({ field: 'discount' }); }
      if (Math.abs(docDisc) > Math.abs(subtotal)) docDisc = subtotal;
    }
    /* group by rate */
    var rates = [];
    var byRate = {};
    lines.forEach(function (l) { if (!own(byRate, l.rate)) { byRate[l.rate] = 0; rates.push(l.rate); } byRate[l.rate] += l.net; });
    rates.sort(function (a, b) { return a - b; });
    var shares = allocate(docDisc, rates.map(function (r) { return byRate[r]; }));
    var inclusive = !!tax.inclusive && tax.mode !== 'none';
    var taxLines = [];
    var taxTotal = 0;
    var taxable = 0;
    rates.forEach(function (r, i) {
      var base = byRate[r] - shares[i];
      if (tax.mode === 'none' || !r) { taxable += base; if (tax.mode !== 'none' && rates.length > 1) taxLines.push({ label: (preset.label || 'Tax') + ' 0%', rate: 0, base: base, amount: 0 }); return; }
      var parts = preset.split && tax.split !== false ? preset.split : [tax.label || preset.label || 'Tax'];
      var each = parts.length;
      /* exclusive: tax = base × rate. inclusive: tax = base × rate / (1 + rate) */
      var net = base;
      parts.forEach(function (lab) {
        var amt;
        if (inclusive) amt = roundDiv(mulDiv(base, r, 1) , (10000 + r) * each);
        else amt = mulDiv(base, r, 10000 * each);
        taxLines.push({ label: lab, rate: Math.round(r / each), rateExact: r / each, base: base, amount: amt });
        taxTotal += amt;
        if (inclusive) net -= amt;
      });
      taxable += inclusive ? net : base;
    });
    var total = inclusive ? taxable + taxTotal : taxable + taxTotal;
    var paid = 0;
    if (doc.paid != null && String(doc.paid).trim() !== '') { paid = parseAmount(doc.paid, dec, sep); if (isNaN(paid)) { errors.push({ field: 'paid' }); paid = 0; } }
    if (doc.type === 'receipt' && (doc.paid == null || String(doc.paid).trim() === '')) paid = total;
    return {
      lines: lines, subtotal: subtotal, lineDiscounts: lineDiscounts, discount: docDisc,
      taxable: taxable, taxes: taxLines, tax: taxTotal, total: total, paid: paid, due: total - paid,
      inclusive: inclusive, errors: errors, decimals: dec
    };
  }

  /* ---------- numbering ---------- */

  var TYPES = {
    invoice: { title: 'Invoice', prefix: 'INV-{YYYY}-{####}', dateLabel: 'Due', terms: true },
    quote: { title: 'Quote', prefix: 'QUO-{YYYY}-{####}', dateLabel: 'Valid until', terms: true },
    estimate: { title: 'Estimate', prefix: 'EST-{YYYY}-{####}', dateLabel: 'Valid until', terms: true },
    receipt: { title: 'Receipt', prefix: 'REC-{YYYY}-{####}', dateLabel: '', terms: false },
    credit: { title: 'Credit note', prefix: 'CN-{YYYY}-{####}', dateLabel: '', terms: false }
  };
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  /* pattern tokens: {YYYY} {YY} {MM} {DD} and {#…#} for the sequence, zero-padded to the number of # */
  function formatNumber(pattern, seq, date) {
    var dt = date ? new Date(date + 'T12:00:00') : new Date();
    if (isNaN(dt.getTime())) dt = new Date();
    var p = String(pattern || '{####}');
    if (!/\{#+\}/.test(p)) p += '{###}';
    return p.replace(/\{YYYY\}/g, String(dt.getFullYear())).replace(/\{YY\}/g, String(dt.getFullYear()).slice(2))
      .replace(/\{MM\}/g, pad(dt.getMonth() + 1, 2)).replace(/\{DD\}/g, pad(dt.getDate(), 2))
      .replace(/\{(#+)\}/g, function (_, h) { return pad(seq, h.length); }).slice(0, 60);
  }

  /* ---------- the on-device store (localStorage, this device only) ---------- */

  var KEY = 'le-docs-v1';
  var memory = null;
  function emptyStore() {
    return { v: 1, business: {}, clients: [], drafts: [], counters: {}, patterns: {}, prefs: {} };
  }
  function load() {
    if (memory) return memory;
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    memory = s && typeof s === 'object' && s.v === 1 ? sanitizeStore(s) : emptyStore();
    return memory;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(memory || emptyStore())); return true; }
    catch (e) { return false; }
  }
  function safeObj(o, fields, max) {
    var out = {};
    if (!o || typeof o !== 'object') return out;
    fields.forEach(function (f) { if (own(o, f) && f !== '__proto__' && f !== 'constructor' && f !== 'prototype') out[f] = str(o[f], max || 600); });
    return out;
  }
  var CLIENT_FIELDS = ['id', 'name', 'contact', 'address', 'email', 'phone', 'taxId', 'notes'];
  var BUSINESS_FIELDS = ['name', 'address', 'email', 'phone', 'website', 'regLabel', 'regValue', 'regLabel2', 'regValue2', 'payment', 'footer'];
  function sanitizeClient(c) {
    var o = safeObj(c, CLIENT_FIELDS, 600);
    if (!o.id || !/^[\w-]{1,60}$/.test(o.id)) o.id = uid('client');
    o.name = str(o.name, 200).trim();
    return o.name ? o : null;
  }
  function sanitizeDoc(x) {
    if (!x || typeof x !== 'object') return null;
    var o = {
      id: /^[\w-]{1,60}$/.test(x.id || '') ? x.id : uid('doc'),
      type: own(TYPES, x.type) ? x.type : 'invoice',
      number: str(x.number, 60), issued: str(x.issued, 10), due: str(x.due, 10), terms: str(x.terms, 20), reference: str(x.reference, 120),
      business: safeObj(x.business, BUSINESS_FIELDS, 600), client: safeObj(x.client, CLIENT_FIELDS, 600),
      items: (Array.isArray(x.items) ? x.items : []).slice(0, 300).map(function (it) { return safeObj(it, ['description', 'qty', 'price', 'discount', 'tax', 'unit'], 2000); }),
      currency: safeObj(x.currency, ['code', 'symbol', 'place', 'style'], 12),
      tax: safeObj(x.tax, ['mode', 'preset', 'rate', 'label'], 40),
      discount: str(x.discount, 30), paid: str(x.paid, 30),
      notes: str(x.notes, 4000), payment: str(x.payment, 2000), qr: str(x.qr, 1000), qrLabel: str(x.qrLabel, 80),
      template: str(x.template, 20), accent: /^#[0-9a-f]{6}$/i.test(x.accent || '') ? x.accent : '', paper: x.paper === 'Letter' ? 'Letter' : 'A4',
      logo: /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x.logo || '') && x.logo.length < 700000 ? x.logo : '',
      status: str(x.status, 20), updated: Number(x.updated) || 0, numberUsed: !!x.numberUsed
    };
    o.currency.decimals = [0, 2, 3].indexOf(Number(x.currency && x.currency.decimals)) >= 0 ? Number(x.currency.decimals) : 2;
    o.currency.space = !!(x.currency && x.currency.space);
    o.tax.inclusive = !!(x.tax && x.tax.inclusive);
    o.tax.split = !(x.tax && x.tax.split === false);
    if (['none', 'doc', 'line'].indexOf(o.tax.mode) < 0) o.tax.mode = 'none';
    return o;
  }
  function sanitizeStore(s) {
    var out = emptyStore();
    out.business = safeObj(s.business, BUSINESS_FIELDS.concat(['logo']), 700000);
    if (out.business.logo && !/^data:image\/(png|jpeg);base64,/.test(out.business.logo)) delete out.business.logo;
    out.clients = (Array.isArray(s.clients) ? s.clients : []).slice(0, 2000).map(sanitizeClient).filter(Boolean);
    out.drafts = (Array.isArray(s.drafts) ? s.drafts : []).slice(0, 500).map(sanitizeDoc).filter(Boolean);
    Object.keys(TYPES).forEach(function (t) {
      var c = s.counters && Number(s.counters[t]);
      if (c >= 0 && c < 1e9) out.counters[t] = Math.floor(c);
      var p = s.patterns && s.patterns[t];
      if (typeof p === 'string' && p.length <= 60) out.patterns[t] = p;
    });
    out.prefs = safeObj(s.prefs, ['currency', 'template', 'accent', 'paper', 'taxPreset', 'taxMode', 'taxRate'], 200);
    return out;
  }
  var store = {
    get: function () { return clone(load()); },
    bytes: function () { try { return (localStorage.getItem(KEY) || '').length * 2; } catch (e) { return 0; } },
    business: function (b) { var s = load(); if (b) { var logo = s.business.logo; s.business = safeObj(b, BUSINESS_FIELDS, 600); if (b.logo !== undefined) logo = b.logo; if (logo && /^data:image\/(png|jpeg);base64,/.test(logo) && logo.length < 700000) s.business.logo = logo; save(); } return clone(s.business); },
    clients: function () { return clone(load().clients); },
    saveClient: function (c) {
      var s = load();
      var o = sanitizeClient(c);
      if (!o) throw new Error('A client needs a name');
      var i = s.clients.findIndex(function (x) { return x.id === o.id; });
      if (i >= 0) s.clients[i] = o; else s.clients.push(o);
      s.clients.sort(function (a, b) { return a.name.localeCompare(b.name); });
      save();
      return clone(o);
    },
    removeClient: function (id) { var s = load(); s.clients = s.clients.filter(function (c) { return c.id !== id; }); save(); },
    eraseClients: function () { var s = load(); s.clients = []; save(); },
    exportClients: function () { return JSON.stringify({ format: 'localeditor-clients', version: 1, clients: load().clients }, null, 2); },
    importClients: function (text) {
      var data;
      try { data = JSON.parse(String(text)); } catch (e) { throw new Error('This is not a client list file.'); }
      var list = Array.isArray(data) ? data : data && Array.isArray(data.clients) ? data.clients : null;
      if (!list) throw new Error('This is not a client list file.');
      var s = load();
      var added = 0, updated = 0, skipped = 0;
      list.slice(0, 2000).forEach(function (c) {
        var o = sanitizeClient(c);
        if (!o) { skipped++; return; }
        var i = s.clients.findIndex(function (x) { return x.id === o.id || (x.name.toLowerCase() === o.name.toLowerCase() && (x.email || '') === (o.email || '')); });
        if (i >= 0) { o.id = s.clients[i].id; s.clients[i] = o; updated++; } else { s.clients.push(o); added++; }
      });
      s.clients.sort(function (a, b) { return a.name.localeCompare(b.name); });
      save();
      return { added: added, updated: updated, skipped: skipped };
    },
    drafts: function () { return clone(load().drafts).sort(function (a, b) { return b.updated - a.updated; }); },
    saveDraft: function (doc) {
      var s = load();
      var o = sanitizeDoc(doc);
      o.updated = Date.now();
      var i = s.drafts.findIndex(function (x) { return x.id === o.id; });
      if (i >= 0) s.drafts[i] = o; else s.drafts.unshift(o);
      if (!save()) throw new Error('This device is out of space for saved documents. Delete some drafts or remove the logo.');
      return clone(o);
    },
    removeDraft: function (id) { var s = load(); s.drafts = s.drafts.filter(function (x) { return x.id !== id; }); save(); },
    pattern: function (type, p) { var s = load(); if (p != null) { s.patterns[type] = str(p, 60) || TYPES[type].prefix; save(); } return s.patterns[type] || TYPES[type].prefix; },
    counter: function (type) { return load().counters[type] || 0; },
    setCounter: function (type, n) { var s = load(); s.counters[type] = Math.max(0, Math.floor(Number(n) || 0)); save(); },
    /* the number the next document of this type would get (not reserved) */
    peekNumber: function (type, date) { return formatNumber(store.pattern(type), store.counter(type) + 1, date); },
    /* marks a number as used: called when a document is downloaded */
    useNumber: function (type, number) {
      var s = load();
      var next = formatNumber(store.pattern(type), (s.counters[type] || 0) + 1, null);
      if (number === next || !number) s.counters[type] = (s.counters[type] || 0) + 1;
      else {
        /* a hand-typed number with a larger sequence moves the counter on, so numbers never repeat */
        var m = /(\d+)\D*$/.exec(number);
        if (m && Number(m[1]) > (s.counters[type] || 0) && Number(m[1]) < 1e9) s.counters[type] = Number(m[1]);
      }
      save();
    },
    prefs: function (p) { var s = load(); if (p) { s.prefs = safeObj(Object.assign({}, s.prefs, p), ['currency', 'template', 'accent', 'paper', 'taxPreset', 'taxMode', 'taxRate'], 200); save(); } return clone(s.prefs); },
    eraseAll: function () { memory = emptyStore(); try { localStorage.removeItem(KEY); } catch (e) {} },
    _reset: function () { memory = null; }
  };

  /* ---------- documents → HTML → real-text PDF ---------- */

  var TEMPLATES = [
    { id: 'classic', name: 'Classic', accent: '#1F3A5F' },
    { id: 'modern', name: 'Modern band', accent: '#5B3FD9' },
    { id: 'minimal', name: 'Minimal', accent: '#16131C' },
    { id: 'bold', name: 'Bold total', accent: '#B4532A' },
    { id: 'compact', name: 'Compact', accent: '#1B7F54' }
  ];
  function nl(s) { return esc(s).replace(/\r?\n/g, '<br>'); }
  function fmtDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
    var dt = new Date(iso + 'T12:00:00');
    try { return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return iso; }
  }
  function blankDoc(type) {
    var prefs = store.prefs();
    var today = new Date();
    var iso = today.getFullYear() + '-' + pad(today.getMonth() + 1, 2) + '-' + pad(today.getDate(), 2);
    var cur = null;
    try { cur = prefs.currency ? JSON.parse(prefs.currency) : null; } catch (e) { cur = null; }
    var doc = sanitizeDoc({
      id: uid('doc'), type: type || 'invoice', issued: iso, terms: type === 'receipt' || type === 'credit' ? '' : '14',
      business: store.business(), client: {}, items: [{ description: '', qty: '1', price: '', discount: '', tax: '' }],
      currency: cur || { code: '', symbol: '', place: 'before', decimals: 2, style: 'en' },
      tax: { mode: prefs.taxMode || 'none', preset: prefs.taxPreset || 'none', rate: prefs.taxRate || '' },
      template: prefs.template || 'classic', accent: prefs.accent || '', paper: prefs.paper || 'A4', logo: (store.business().logo || '')
    });
    doc.number = store.peekNumber(doc.type, iso);
    doc.due = dueFrom(doc.issued, doc.terms);
    return doc;
  }
  function dueFrom(issued, terms) {
    var days = Number(terms);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issued || '') || !(days >= 0) || String(terms) === '') return '';
    var dt = new Date(issued + 'T12:00:00');
    dt.setDate(dt.getDate() + days);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1, 2) + '-' + pad(dt.getDate(), 2);
  }

  function qrDataUrl(text) {
    var q = global.qrcode;
    if (!q || !text) return '';
    try {
      if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
      var code = q(0, 'M');
      code.addData(String(text).slice(0, 900), 'Byte');
      code.make();
      var n = code.getModuleCount(), cell = 6, quiet = 2;
      var c = d.createElement('canvas');
      c.width = c.height = (n + quiet * 2) * cell;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#000';
      for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (code.isDark(r, k)) ctx.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  }

  /* HTML the text PDF writer lays out. Everything the person typed is escaped. */
  function docHtml(doc, t, opts) {
    opts = opts || {};
    var tpl = TEMPLATES.filter(function (x) { return x.id === doc.template; })[0] || TEMPLATES[0];
    var accent = doc.accent || tpl.accent;
    var cur = doc.currency;
    var ty = TYPES[doc.type] || TYPES.invoice;
    var title = ty.title;
    var b = doc.business || {}, c = doc.client || {};
    var money = function (v) { return esc(formatMoney(v, cur)); };
    var muted = 'color:#5E5967';
    var showDisc = t.lines.some(function (l) { return l.discount; });
    var showTax = doc.tax.mode === 'line';
    var band = tpl.id === 'modern';
    var size = tpl.id === 'compact' ? 'font-size:9pt' : '';
    var h = [];
    /* header: business and logo on the left, document title and number on the right */
    var left = (doc.logo ? '<img src="' + doc.logo + '" alt="Logo" style="height:' + (tpl.id === 'compact' ? 34 : 46) + 'pt">' : '') +
      '<p style="font-size:' + (doc.logo ? 11.5 : 15) + 'pt;font-weight:bold;' + (band ? 'color:#ffffff' : 'color:#16131C') + '">' + esc(b.name || 'Your business name') + '</p>' +
      '<p style="' + (band ? 'color:#EDE9FF' : muted) + '">' + nl(b.address) + (b.email ? '<br>' + esc(b.email) : '') + (b.phone ? '<br>' + esc(b.phone) : '') + (b.website ? '<br>' + esc(b.website) : '') +
      (b.regValue ? '<br>' + esc(b.regLabel || 'Tax ID') + ': ' + esc(b.regValue) : '') + (b.regValue2 ? '<br>' + esc(b.regLabel2 || 'Reg. no.') + ': ' + esc(b.regValue2) : '') + '</p>';
    var right = '<p style="text-align:right;font-size:' + (tpl.id === 'bold' ? 26 : 21) + 'pt;font-weight:bold;' + (band ? 'color:#ffffff' : 'color:' + accent) + '">' + esc(title.toUpperCase()) + '</p>' +
      '<p style="text-align:right;' + (band ? 'color:#EDE9FF' : '') + '"><b>' + esc(doc.number || '') + '</b></p>';
    var bandStyle = band ? 'background-color:' + accent + ';padding:14pt' : 'padding:0 0 8pt 0';
    h.push('<table style="width:100%;border:none" border="0"><tr><td style="width:60%;' + bandStyle + '">' + left + '</td><td style="width:40%;vertical-align:top;' + bandStyle + '">' + right + '</td></tr></table>');
    if (!band) h.push('<hr>');
    /* bill to + details */
    var who = doc.type === 'receipt' ? 'Received from' : doc.type === 'quote' || doc.type === 'estimate' ? 'Prepared for' : doc.type === 'credit' ? 'Credit to' : 'Bill to';
    var billTo = '<p style="font-size:8pt;font-weight:bold;color:' + accent + '">' + esc(who.toUpperCase()) + '</p>' +
      '<p><b>' + esc(c.name || '') + '</b>' + (c.contact ? '<br>' + esc(c.contact) : '') + (c.address ? '<br>' + nl(c.address) : '') + (c.email ? '<br>' + esc(c.email) : '') + (c.phone ? '<br>' + esc(c.phone) : '') + (c.taxId ? '<br>' + esc(b.regLabel || 'Tax ID') + ': ' + esc(c.taxId) : '') + '</p>';
    var rows = [['Date', fmtDate(doc.issued)]];
    if (ty.dateLabel && doc.due) rows.push([ty.dateLabel, fmtDate(doc.due)]);
    if (doc.type === 'invoice' && doc.terms !== '' && doc.terms != null) rows.push(['Terms', Number(doc.terms) === 0 ? 'Due on receipt' : 'Net ' + esc(doc.terms) + ' days']);
    if (doc.reference) rows.push(['Reference', esc(doc.reference)]);
    if (cur.code) rows.push(['Currency', esc(cur.code)]);
    var details = '<table style="width:100%;border:none" border="0">' + rows.map(function (r) {
      return '<tr><td style="padding:1pt 6pt 1pt 0;' + muted + '">' + esc(r[0]) + '</td><td style="padding:1pt 0;text-align:right">' + (r[0] === 'Terms' || r[0] === 'Reference' || r[0] === 'Currency' ? r[1] : esc(r[1])) + '</td></tr>';
    }).join('') + '</table>';
    h.push('<table style="width:100%;border:none" border="0"><tr><td style="width:55%;padding:10pt 0 6pt 0">' + billTo + '</td><td style="width:45%;padding:10pt 0 6pt 0">' + details + '</td></tr></table>');
    /* line items */
    var headBg = tpl.id === 'minimal' ? '' : 'background-color:' + (tpl.id === 'classic' || tpl.id === 'compact' ? '#F1F0EC' : accent) + ';';
    var headColor = tpl.id === 'modern' || tpl.id === 'bold' ? 'color:#ffffff;' : '';
    var th = function (txt, align) { return '<th style="' + headBg + headColor + 'text-align:' + (align || 'left') + ';padding:5pt">' + esc(txt) + '</th>'; };
    var head = '<tr>' + th('Description') + th('Qty', 'right') + th('Unit price', 'right') + (showDisc ? th('Discount', 'right') : '') + (showTax ? th(doc.tax.label || 'Tax', 'right') : '') + th('Amount', 'right') + '</tr>';
    var body = t.lines.map(function (l) {
      var it = doc.items[l.index] || {};
      var td = function (v, align) { return '<td style="text-align:' + (align || 'left') + ';padding:5pt;border-bottom:1px solid #E3E0DA">' + v + '</td>'; };
      return '<tr>' + td(nl(it.description || '')) + td(esc(formatQty(l.qty) + (it.unit ? ' ' + it.unit : '')), 'right') + td(money(l.price), 'right') +
        (showDisc ? td(l.discount ? '\u2212' + esc(formatMoney(l.discount, cur)) : '', 'right') : '') + (showTax ? td(esc(formatRate(l.rate)), 'right') : '') + td(money(l.net), 'right') + '</tr>';
    }).join('');
    h.push('<table style="width:100%" border="0"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>');
    /* totals */
    var tr = function (label, value, strong, big) {
      var st = strong ? 'font-weight:bold;' : '';
      var fs = big ? 'font-size:' + (tpl.id === 'bold' ? 15 : 12) + 'pt;' : '';
      var bg = big && tpl.id === 'bold' ? 'background-color:' + accent + ';color:#ffffff;' : big ? 'border-top:1px solid #16131C;' : '';
      return '<tr><td style="padding:3pt 6pt;' + st + fs + bg + '">' + esc(label) + '</td><td style="padding:3pt 6pt;text-align:right;' + st + fs + bg + '">' + esc(value) + '</td></tr>';
    };
    var tot = [];
    tot.push(tr('Subtotal', formatMoney(t.subtotal, cur)));
    if (t.discount) tot.push(tr('Discount' + (/%$/.test(String(doc.discount).trim()) ? ' (' + String(doc.discount).trim() + ')' : ''), '\u2212' + formatMoney(t.discount, cur)));
    if (doc.tax.mode !== 'none') {
      var bases = {};
      t.taxes.forEach(function (x) { bases[x.base] = 1; });
      var several = Object.keys(bases).length > 1; /* several rates: say what each tax is on */
      t.taxes.forEach(function (x) {
        var rate = x.rateExact != null && x.rateExact !== Math.round(x.rateExact) ? formatRate(Math.round(x.rateExact)) : formatRate(x.rate);
        tot.push(tr(x.label + ' ' + rate + (t.inclusive ? ' (included)' : '') + (several ? ' on ' + formatMoney(x.base, cur) : ''), formatMoney(x.amount, cur)));
      });
    }
    var label = doc.type === 'credit' ? 'Total credit' : doc.type === 'receipt' ? 'Total' : doc.type === 'invoice' ? 'Total' : 'Total';
    tot.push(tr(label + (cur.code ? ' (' + cur.code + ')' : ''), formatMoney(t.total, cur), true, true));
    if (doc.type === 'receipt') tot.push(tr('Amount received', formatMoney(t.paid, cur), true));
    else if (doc.type === 'invoice' && t.paid) { tot.push(tr('Paid', '\u2212' + formatMoney(t.paid, cur))); tot.push(tr('Balance due', formatMoney(t.due, cur), true)); }
    h.push('<table align="right" style="width:46%;border:none" border="0">' + tot.join('') + '</table>');
    /* notes, payment, QR */
    var tail = [];
    if (doc.payment || b.payment) tail.push('<p style="font-size:8pt;font-weight:bold;color:' + accent + '">PAYMENT DETAILS</p><p>' + nl(doc.payment || b.payment) + '</p>');
    if (doc.notes) tail.push('<p style="font-size:8pt;font-weight:bold;color:' + accent + '">NOTES</p><p>' + nl(doc.notes) + '</p>');
    var qr = doc.qr && opts.qr !== false ? qrDataUrl(doc.qr) : '';
    if (tail.length || qr) {
      h.push('<table style="width:100%;border:none" border="0"><tr><td style="padding:14pt 12pt 0 0;vertical-align:top">' + tail.join('') + '</td>' +
        (qr ? '<td style="width:112pt;padding:14pt 0 0 0;text-align:center;vertical-align:top"><img src="' + qr + '" alt="Payment QR code" style="width:86pt;height:86pt"><p style="font-size:7.5pt;' + muted + '">' + esc(doc.qrLabel || 'Scan to pay') + '</p></td>' : '') + '</tr></table>');
    }
    if (b.footer) h.push('<p style="text-align:center;font-size:8pt;' + muted + '">' + nl(b.footer) + '</p>');
    return '<div style="' + size + '">' + h.join('') + '</div>';
  }

  function renderDoc(doc, opts) {
    opts = opts || {};
    doc = sanitizeDoc(doc);
    var t = totals(doc);
    var jobs = [lazy('assets/js/le-pdf-flow.js')];
    if (doc.qr && !global.qrcode) jobs.push(lazy('assets/vendor/qrcode.js').catch(function () {}));
    return Promise.all(jobs).then(function () {
      var html = docHtml(doc, t, opts);
      var ty = TYPES[doc.type];
      return LE.pdfFlow.render(html, {
        pageSize: doc.paper === 'Letter' ? 'Letter' : 'A4', margin: doc.template === 'compact' ? 36 : 44, fontSize: doc.template === 'compact' ? 9 : 9.5,
        base: doc.template === 'classic' ? 'serif' : 'sans', outline: false,
        title: ty.title + ' ' + (doc.number || ''), author: (doc.business && doc.business.name) || '', subject: ty.title + (doc.client && doc.client.name ? ' for ' + doc.client.name : ''),
        footer: opts.pageNumbers === false ? '' : (doc.number ? doc.number + ' · ' : '') + 'Page {page} of {pages}'
      }).then(function (res) { res.totals = t; res.html = html; return res; });
    });
  }
  function fileName(doc) {
    var ty = TYPES[doc.type] || TYPES.invoice;
    var base = (ty.title + ' ' + (doc.number || '') + (doc.client && doc.client.name ? ' ' + doc.client.name : '')).replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '').replace(/\s+/g, '-').slice(0, 100);
    return (base || 'document') + '.pdf';
  }

  /* =====================================================================
     D18 — tables from PDF text positions (best effort)
     ===================================================================== */

  function pdfjs() {
    if (global.pdfjsLib && global.pdfjsLib.getDocument) return Promise.resolve(global.pdfjsLib);
    if (LE.pdf && LE.pdf.ready) return LE.pdf.ready().then(function () { return global.pdfjsLib; });
    return lazy('assets/vendor/pdf.min.js').then(function () {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = asset('assets/vendor/pdf.worker.min.js');
      return global.pdfjsLib;
    });
  }
  function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }

  /* text items of one page in top-down page points: { x0, x1, y (baseline), top, size, str, bold } */
  function pageItems(page) {
    var vp = page.getViewport({ scale: 1 });
    return page.getTextContent().then(function (tc) {
      var out = [];
      tc.items.forEach(function (it) {
        if (!it.str || !/\S/.test(it.str)) return;
        var m = global.pdfjsLib.Util.transform(vp.transform, it.transform);
        var size = Math.hypot(m[2], m[3]) || it.height || 10;
        if (Math.abs(m[1]) > 0.01 * size) return; /* rotated text is not part of a table */
        var x0 = m[4], y = m[5];
        var w = it.width * (vp.scale || 1);
        var style = tc.styles && tc.styles[it.fontName];
        var bold = /bold|black|heavy|semibold/i.test((style && style.fontFamily) || '') || /bold/i.test(it.fontName || '');
        /* one item holding several columns ("A    1    2"): split at runs of 3+ spaces */
        var parts = it.str.split(/(\s{3,})/);
        if (parts.length > 1 && it.str.length) {
          var cw = w / it.str.length, pos = 0;
          parts.forEach(function (p) {
            if (p && /\S/.test(p)) {
              var lead = p.length - p.replace(/^\s+/, '').length;
              out.push({ x0: x0 + (pos + lead) * cw, x1: x0 + (pos + p.replace(/\s+$/, '').length) * cw, y: y, size: size, str: p.trim(), bold: bold });
            }
            pos += p.length;
          });
        } else out.push({ x0: x0, x1: x0 + w, y: y, size: size, str: it.str.trim(), bold: bold });
      });
      return { items: out, width: vp.width, height: vp.height };
    });
  }

  /* rows of chunks: items on one baseline, neighbours closer than ~0.4 em joined into one chunk */
  function toRows(items) {
    var sorted = items.slice().sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; });
    var rows = [];
    sorted.forEach(function (it) {
      var r = rows[rows.length - 1];
      if (r && Math.abs(r.y - it.y) <= Math.max(1.5, Math.min(r.size, it.size) * 0.45)) { r.items.push(it); r.size = Math.max(r.size, it.size); }
      else rows.push({ y: it.y, size: it.size, items: [it] });
    });
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x0 - b.x0; });
      var chunks = [];
      r.items.forEach(function (it) {
        var c = chunks[chunks.length - 1];
        var gap = c ? it.x0 - c.x1 : Infinity;
        if (c && gap < Math.max(1.2, it.size * 0.4)) { c.str += (gap > it.size * 0.12 ? ' ' : '') + it.str; c.x1 = Math.max(c.x1, it.x1); c.bold = c.bold && it.bold; }
        else chunks.push({ x0: it.x0, x1: it.x1, str: it.str, bold: it.bold, size: it.size });
      });
      r.chunks = chunks;
    });
    return rows;
  }

  /* column separators from where no chunk of a multi-chunk row sits */
  function columnsOf(rows) {
    var multi = rows.filter(function (r) { return r.chunks.length >= 2; });
    if (!multi.length) return null;
    var lo = Infinity, hi = -Infinity;
    multi.forEach(function (r) { r.chunks.forEach(function (c) { lo = Math.min(lo, c.x0); hi = Math.max(hi, c.x1); }); });
    var W = Math.ceil(hi - lo) + 2;
    if (W > 5000) return null;
    var cover = new Array(W).fill(0);
    multi.forEach(function (r) {
      r.chunks.forEach(function (c) {
        for (var x = Math.floor(c.x0 - lo); x <= Math.ceil(c.x1 - lo) && x < W; x++) cover[x]++;
      });
    });
    var tol = Math.max(0, Math.floor(multi.length * 0.08));
    var cols = [];
    var inCol = false, start = 0;
    for (var x = 0; x < W; x++) {
      var on = cover[x] > tol;
      if (on && !inCol) { inCol = true; start = x; }
      if (!on && inCol) { inCol = false; cols.push([start + lo, x + lo]); }
    }
    if (inCol) cols.push([start + lo, W + lo]);
    /* gaps narrower than ~0.45 em are word spaces, not column gaps */
    var em = multi[0].size || 10;
    var merged = [];
    cols.forEach(function (c) {
      var m = merged[merged.length - 1];
      if (m && c[0] - m[1] < em * 0.45) m[1] = c[1];
      else merged.push(c.slice());
    });
    return merged.length >= 2 ? merged : null;
  }

  function isNumberish(s) { return /^[-+(]?[$€£¥₹]?\s?\d[\d,.\s]*%?\)?$/.test(String(s).trim()); }

  /* builds a grid from rows and columns; wrapped lines are merged into the cell above */
  function grid(rows, cols) {
    var lineH = median(rows.map(function (r) { return r.size; })) * 1.2 || 12;
    var out = [];
    var prevY = null;
    var firstFilled = rows.filter(function (r) { return r.chunks.some(function (c) { return overlapIdx(c, cols) === 0; }); }).length / Math.max(1, rows.length);
    rows.forEach(function (r) {
      var cells = cols.map(function () { return ''; });
      var bold = cols.map(function () { return null; });
      var spans = 0;
      r.chunks.forEach(function (c) {
        var idx = overlapIdx(c, cols);
        if (idx < 0) return;
        /* a chunk spanning several columns stays in the first; counted so the row is not mistaken for data */
        var covered = cols.filter(function (col) { return Math.min(col[1], c.x1) - Math.max(col[0], c.x0) > 1; }).length;
        if (covered > 1) spans++;
        cells[idx] = cells[idx] ? cells[idx] + ' ' + c.str : c.str;
        bold[idx] = bold[idx] == null ? c.bold : bold[idx] && c.bold;
      });
      var filled = cells.filter(Boolean).length;
      var gap = prevY == null ? Infinity : r.y - prevY;
      var prev = out[out.length - 1];
      /* a wrapped line: close below the row above, and either the first column is empty (it is filled in most rows)
         or only a few text cells continue cells that are already filled */
      var continuation = prev && gap < lineH * 1.6 && filled > 0 && (
        (firstFilled >= 0.5 && !cells[0] && prev.cells[0] && filled < cols.length) ||
        (gap < lineH * 1.35 && filled <= Math.max(1, Math.floor(cols.length / 3)) && cells.every(function (v, i) { return !v || prev.cells[i]; }) && !cells.some(function (v) { return isNumberish(v); }) && prev.cells.filter(Boolean).length === cols.length)
      );
      if (continuation) {
        cells.forEach(function (v, i) { if (v) prev.cells[i] = prev.cells[i] ? prev.cells[i] + ' ' + v : v; });
        prev.wrapped = true;
      } else out.push({ cells: cells, bold: bold, y: r.y, spans: spans });
      prevY = r.y;
    });
    return out;
  }
  function overlapIdx(c, cols) {
    var best = -1, bestOv = 0;
    cols.forEach(function (col, i) {
      var ov = Math.min(col[1], c.x1) - Math.max(col[0], c.x0);
      if (ov > bestOv) { bestOv = ov; best = i; }
    });
    if (best < 0) {
      var cx = (c.x0 + c.x1) / 2, dist = Infinity;
      cols.forEach(function (col, i) { var dd = cx < col[0] ? col[0] - cx : cx > col[1] ? cx - col[1] : 0; if (dd < dist) { dist = dd; best = i; } });
    }
    return best;
  }
  function median(a) { var s = a.filter(function (x) { return x > 0; }).sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }

  function headerOf(g) {
    if (g.length < 2) return false;
    var first = g[0].cells;
    if (!first.every(function (v) { return v && !isNumberish(v); })) return false;
    var bodyNums = g.slice(1).some(function (r) { return r.cells.some(isNumberish); });
    var boldHead = g[0].bold.every(function (b) { return b; }) && g.slice(1).some(function (r) { return r.bold.some(function (b) { return b === false; }); });
    return bodyNums || boldHead || g.length >= 3;
  }

  /* finds table blocks on one page: runs of rows with 2+ chunks sharing column gaps */
  function detect(rows, rect) {
    if (rect) {
      var inRect = rows.map(function (r) {
        var ch = r.chunks.filter(function (c) { return c.x1 > rect.x && c.x0 < rect.x + rect.w && r.y > rect.y && r.y - r.size * 0.8 < rect.y + rect.h; });
        return ch.length ? { y: r.y, size: r.size, chunks: ch } : null;
      }).filter(Boolean);
      var cols = columnsOf(inRect);
      if (!cols) return inRect.length ? [{ rows: inRect, cols: [[rect.x, rect.x + rect.w]] }] : [];
      return [{ rows: inRect, cols: cols }];
    }
    var blocks = [];
    var cur = [];
    var lineH = median(rows.map(function (r) { return r.size; })) * 1.2 || 12;
    function close() {
      /* trailing one-chunk rows stay only when they sit inside a later column (a wrapped last cell), not at the left edge */
      var left = cur.length ? Math.min.apply(null, cur.filter(function (r) { return r.chunks.length >= 2; }).map(function (r) { return r.chunks[0].x0; }).concat([Infinity])) : 0;
      while (cur.length && cur[cur.length - 1].chunks.length < 2 && cur[cur.length - 1].chunks[0].x0 < left + 10) cur.pop();
      if (cur.filter(function (r) { return r.chunks.length >= 2; }).length >= 2) {
        var cols = columnsOf(cur);
        if (cols) blocks.push({ rows: cur, cols: cols });
      }
      cur = [];
    }
    rows.forEach(function (r) {
      var last = cur[cur.length - 1];
      var gap = last ? r.y - last.y : 0;
      if (last && gap > lineH * 3.2) close();
      if (r.chunks.length >= 2) { cur.push(r); return; }
      /* a one-chunk row continues a table only when it is close (a wrapped cell) */
      if (cur.length && gap < lineH * 1.45 && r.chunks[0].x0 > (cur[0].chunks[0].x0 - 2)) cur.push(r);
      else close();
    });
    close();
    /* split blocks where the column structure changes: keep rows that agree with the block's columns */
    return blocks;
  }

  function tableFromBlock(b, pageNo) {
    var g = grid(b.rows, b.cols);
    /* drop empty columns */
    var keep = b.cols.map(function (_, i) { return g.some(function (r) { return r.cells[i]; }); });
    var cols = b.cols.filter(function (_, i) { return keep[i]; });
    g.forEach(function (r) { r.cells = r.cells.filter(function (_, i) { return keep[i]; }); r.bold = r.bold.filter(function (_, i) { return keep[i]; }); });
    var header = headerOf(g);
    return {
      page: pageNo, pages: [pageNo], header: header,
      columns: cols.map(function (c) { return { x0: Math.round(c[0] * 10) / 10, x1: Math.round(c[1] * 10) / 10 }; }),
      rows: g.map(function (r) { return r.cells; }),
      box: { x: cols[0][0], y: b.rows[0].y - b.rows[0].size, w: cols[cols.length - 1][1] - cols[0][0], h: b.rows[b.rows.length - 1].y - b.rows[0].y + b.rows[0].size * 1.3 }
    };
  }

  /* extractTables(bytes, { page: 0-based | 'all', rect: {x,y,w,h} in top-down PDF points, password, mergePages }) → tables */
  function extractTables(bytes, opts) {
    opts = opts || {};
    return pdfjs().then(function (lib) {
      var params = { data: u8(bytes).slice(0), isEvalSupported: false };
      if (opts.password != null) params.password = opts.password;
      return lib.getDocument(params).promise.then(function (pdf) {
        var pages = [];
        if (opts.page === 'all' || opts.page == null) for (var i = 0; i < Math.min(pdf.numPages, 300); i++) pages.push(i);
        else pages.push(Math.max(0, Math.min(pdf.numPages - 1, Number(opts.page) || 0)));
        var tables = [];
        var scanned = 0;
        var chain = Promise.resolve();
        pages.forEach(function (pi) {
          chain = chain.then(function () {
            return pdf.getPage(pi + 1).then(function (page) {
              return pageItems(page).then(function (res) {
                page.cleanup();
                if (!res.items.length) { scanned++; return; }
                var rows = toRows(res.items);
                detect(rows, opts.rect || null).forEach(function (b) {
                  var t = tableFromBlock(b, pi);
                  if (t.rows.length) tables.push(t);
                });
              });
            });
          });
        });
        return chain.then(function () {
          pdf.destroy();
          var out = opts.mergePages === false ? tables : mergeAcrossPages(tables);
          out.scannedPages = scanned;
          out.pageCount = pages.length;
          return out;
        });
      });
    });
  }
  /* a table that continues on the next page (same columns), with its header repeated, becomes one table */
  function mergeAcrossPages(tables) {
    var out = [];
    tables.forEach(function (t) {
      var prev = out[out.length - 1];
      var same = prev && t.page === prev.pages[prev.pages.length - 1] + 1 && prev.columns.length === t.columns.length &&
        prev.columns.every(function (c, i) { return Math.abs(c.x0 - t.columns[i].x0) < 8 || Math.abs(c.x1 - t.columns[i].x1) < 8; });
      if (same) {
        var rows = t.rows;
        if (prev.header && rows.length && rows[0].join('\u0001') === prev.rows[0].join('\u0001')) rows = rows.slice(1);
        prev.rows = prev.rows.concat(rows);
        prev.pages.push(t.page);
      } else out.push(t);
    });
    return out;
  }

  /* numbers only when unambiguous: no leading zeros, no thousands commas without decimals, no dates or IDs */
  function plainNumber(s) {
    s = String(s == null ? '' : s).trim();
    if (!s || s.length > 15) return null;
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)) return Number(s);
    if (/^-?[1-9]\d{0,2}(,\d{3})+\.\d+$/.test(s) || /^-?[1-9]\d{0,2}(,\d{3}){2,}$/.test(s)) return Number(s.replace(/,/g, ''));
    return null;
  }
  function columnTypes(table) {
    var body = table.header ? table.rows.slice(1) : table.rows;
    return (table.rows[0] || []).map(function (_, i) {
      var vals = body.map(function (r) { return r[i]; }).filter(function (v) { return v && String(v).trim(); });
      return vals.length && vals.every(function (v) { return plainNumber(v) != null; }) ? 'number' : 'text';
    });
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v) && plainNumber(v) == null) v = "'" + v; /* stop spreadsheet formula injection */
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(rows) { return '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }
  /* toXlsx([{ name, rows, types }]) → Uint8Array. Text stays text (never a formula); numbers only where types says so. */
  function toXlsx(sheets) {
    return lazy('assets/vendor/xlsx.full.min.js').then(function () {
      var X = global.XLSX;
      var wb = X.utils.book_new();
      var used = {};
      sheets.forEach(function (sh, si) {
        var types = sh.types || [];
        var aoa = sh.rows.map(function (r, ri) {
          return r.map(function (v, ci) {
            if (types[ci] === 'number' && !(sh.header && ri === 0)) { var n = plainNumber(v); if (n != null) return n; }
            return String(v == null ? '' : v);
          });
        });
        var ws = X.utils.aoa_to_sheet(aoa);
        /* make sure strings are stored as strings */
        Object.keys(ws).forEach(function (k) { if (k.charAt(0) !== '!' && ws[k].t === 's') { ws[k].t = 's'; delete ws[k].f; } });
        ws['!cols'] = (sh.rows[0] || []).map(function (_, ci) { var w = 6; sh.rows.forEach(function (r) { w = Math.max(w, Math.min(60, String(r[ci] || '').length + 1)); }); return { wch: w }; });
        var name = String(sh.name || ('Table ' + (si + 1))).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 28) || 'Table';
        while (used[name.toLowerCase()]) name = name.slice(0, 25) + ' ' + (si + 1);
        used[name.toLowerCase()] = 1;
        X.utils.book_append_sheet(wb, ws, name);
      });
      var out = X.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
      return new Uint8Array(out);
    });
  }

  LE.pdfDocs = {
    /* money */
    parseAmount: parseAmount, parseQty: parseQty, parseRate: parseRate, formatMoney: formatMoney, formatQty: formatQty, formatRate: formatRate,
    mulDiv: mulDiv, allocate: allocate, totals: totals,
    /* documents */
    TYPES: TYPES, TEMPLATES: TEMPLATES, TAX_PRESETS: TAX_PRESETS, NUMBER_STYLES: Object.keys(STYLES),
    blank: blankDoc, sanitize: sanitizeDoc, html: function (doc) { doc = sanitizeDoc(doc); return docHtml(doc, totals(doc), {}); },
    render: renderDoc, fileName: fileName, formatNumber: formatNumber, dueFrom: dueFrom, store: store,
    /* tables */
    extractTables: extractTables, columnTypes: columnTypes, plainNumber: plainNumber, toCsv: toCsv, toXlsx: toXlsx,
    _internals: { toRows: toRows, columnsOf: columnsOf, grid: grid, detect: detect }
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =====================================================================
   Part 2 — "Business docs" in the PDF studio: invoice/quote/receipt maker and table extraction.
   A panel (PS.panels.docs) lists the jobs; each opens a full-height workbench over the studio.
   ===================================================================== */
(function (global) {
  'use strict';

  var LE = global.LE || {};
  var PS = global.PS;
  var D = LE.pdfDocs;
  var d = global.document;
  if (!PS || !PS.panels || !D || !d) return;
  var S = PS.S;

  var ICONS = {
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 19a5 5 0 0 0-2.6-4.4"/>',
    shield: '<path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6z"/>',
    split: '<path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/>',
    merge: '<path d="M4 12h6M20 12h-6M7 8l4 4-4 4M17 8l-4 4 4 4"/>'
  };
  function ic(name) {
    if (ICONS[name]) return '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
    return PS.icon(name);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(tag, cls, html, attrs) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function btn(cls, html, onClick, attrs) {
    var b = h('button', cls, html, Object.assign({ type: 'button' }, attrs || {}));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || d).querySelectorAll(s)); }
  function say(m, ms) { if (PS.say) PS.say(m, ms); }
  function download(blob, name) { if (global.IT && IT.download) IT.download(blob, name); }
  function fmtBytes(n) { return global.IT && IT.formatBytes ? IT.formatBytes(n) : Math.round(n / 1024) + ' KB'; }
  function isoToday() { var t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 101).slice(1) + '-' + String(t.getDate() + 100).slice(1); }
  var fid = 0;
  /* a labelled field: input, textarea or select */
  function field(label, kind, value, opts) {
    opts = opts || {};
    var id = 'pd-f' + (++fid);
    var wrap = h('div', 'pd-field' + (opts.cls ? ' ' + opts.cls : ''));
    wrap.appendChild(h('label', null, esc(label), { for: id }));
    var el;
    if (kind === 'textarea') { el = h('textarea', 'input pd-ta', null, { id: id, rows: String(opts.rows || 3) }); el.value = value || ''; }
    else if (kind === 'select') {
      el = h('select', 'input', null, { id: id });
      (opts.options || []).forEach(function (o) { el.appendChild(h('option', null, esc(o[1]), { value: o[0] })); });
      el.value = value == null ? '' : value;
    } else {
      el = h('input', 'input', null, { id: id, type: kind || 'text', autocomplete: 'off' });
      el.value = value == null ? '' : value;
      if (opts.inputmode) el.setAttribute('inputmode', opts.inputmode);
    }
    if (opts.placeholder) el.placeholder = opts.placeholder;
    if (opts.key) el.setAttribute('data-k', opts.key);
    wrap.appendChild(el);
    if (opts.hint) wrap.appendChild(h('p', 'pd-hint', esc(opts.hint)));
    wrap.input = el;
    return wrap;
  }
  function seg(label, options, value, onPick) {
    var wrap = h('div', 'pd-field');
    var lid = 'pd-l' + (++fid);
    wrap.appendChild(h('span', 'pd-label', esc(label), { id: lid }));
    var g = h('div', 'seg pd-seg', null, { role: 'group', 'aria-labelledby': lid });
    options.forEach(function (o) {
      var b = btn('', esc(o[1]), function () { $$('button', g).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); onPick(o[0]); }, { 'aria-pressed': String(o[0] === value), 'data-v': o[0] });
      g.appendChild(b);
    });
    wrap.appendChild(g);
    return wrap;
  }
  function section(title, sub) {
    var s = h('section', 'pd-sec');
    s.appendChild(h('h3', 'pd-sec-title', esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '')));
    return s;
  }

  /* ---------- the panel ---------- */

  var JOBS = [
    { id: 'invoice', title: 'Invoice' }, { id: 'quote', title: 'Quote' }, { id: 'estimate', title: 'Estimate' },
    { id: 'receipt', title: 'Receipt' }, { id: 'credit', title: 'Credit note' }
  ];
  PS.panels.docs = {
    title: 'Business docs', icon: 'file', tone: 'amber', snap: 'half', noDoc: true,
    build: function (pane) { renderPanel(pane); },
    show: function (pane) { renderPanel(pane); }
  };
  function renderPanel(pane) {
    pane.innerHTML = '';
    pane.appendChild(h('p', 'ps-note ps-lead', 'Invoices, quotes and receipts with real, searchable text, and tables from a PDF into a spreadsheet.'));
    pane.appendChild(h('h4', 'pd-panel-h', 'New document'));
    var grid = h('div', 'pd-new');
    JOBS.forEach(function (j) {
      grid.appendChild(btn('pd-new-b', ic('receipt') + '<span>' + esc(j.title) + '</span>', function () { openEditor(D.blank(j.id)); }, { 'data-new': j.id }));
    });
    pane.appendChild(grid);
    var drafts = D.store.drafts();
    if (drafts.length) {
      pane.appendChild(h('h4', 'pd-panel-h', 'Saved on this device'));
      var ul = h('ul', 'pd-drafts');
      drafts.slice(0, 12).forEach(function (doc) {
        var t = D.totals(doc);
        var li = h('li', 'pd-draft');
        li.appendChild(btn('pd-draft-open', '<strong>' + esc((D.TYPES[doc.type] || {}).title + ' ' + (doc.number || '')) + '</strong><small>' + esc((doc.client && doc.client.name) || 'No client yet') + ' · ' + esc(D.formatMoney(t.total, doc.currency)) + '</small>', function () { openEditor(doc); }, { 'data-draft': doc.id }));
        li.appendChild(btn('ps-ib pd-draft-x', PS.icon('trash'), function () {
          if (!global.confirm('Delete this saved ' + ((D.TYPES[doc.type] || {}).title || 'document').toLowerCase() + '?')) return;
          D.store.removeDraft(doc.id);
          renderPanel(pane);
        }, { 'aria-label': 'Delete ' + (doc.number || 'draft'), title: 'Delete' }));
        ul.appendChild(li);
      });
      pane.appendChild(ul);
    }
    pane.appendChild(h('h4', 'pd-panel-h', 'From a PDF'));
    pane.appendChild(btn('pd-job', '<span class="pd-job-ic">' + ic('table') + '</span><span class="pd-job-text"><strong>Extract tables to a spreadsheet</strong><small>Find tables in a PDF and save them as Excel or CSV. Best effort: check the result.</small></span>' + ic('chevron'), function () { openTables(); }, { 'data-job': 'tables' }));
    pane.appendChild(btn('pd-job', '<span class="pd-job-ic">' + ic('users') + '</span><span class="pd-job-text"><strong>Client list</strong><small>' + D.store.clients().length + ' saved on this device. Export, import or erase.</small></span>' + ic('chevron'), function () { openClients(); }, { 'data-job': 'clients' }));
    pane.appendChild(h('p', 'pd-private', ic('shield') + '<span>A document maker, not accounting software. Everything stays on this device.</span>'));
  }
  function refreshPanel() { var p = $('.ps-pane[data-pane="docs"]'); if (p) renderPanel(p); }

  function addEntryPoints() {
    var rail = $('#ps-rail');
    if (rail && !$('[data-panel="docs"]', rail)) {
      var b = h('button', null, ic('receipt') + '<span>Docs</span>', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-panel': 'docs', title: 'Invoices and tables', 'aria-label': 'Business documents' });
      var exp = $('[data-panel="export"]', rail);
      rail.insertBefore(b, exp || null);
    }
    var starts = $('.ps-empty .ps-starts');
    if (starts && !$('.pd-entry')) {
      var link = btn('pd-entry', ic('receipt') + '<span><strong>Invoice or quote</strong> · make one, or pull tables out of a PDF</span>' + ic('chevron'), function () { PS.openPanel('docs'); }, { 'data-act-docs': 'open' });
      var after = $('.pb-entry') || starts;
      after.parentNode.insertBefore(link, after.nextSibling);
    }
  }

  /* ---------- workbench ---------- */

  var W = null, current = null;
  function workbench() {
    if (W) return W;
    W = h('section', 'pd-work', '', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pd-work-title', hidden: '' });
    W.innerHTML = '<header class="pd-head"><button class="ps-ib pd-close" type="button" aria-label="Back to the studio">' + ic('back') + '</button>' +
      '<div class="pd-head-text"><h2 id="pd-work-title"></h2><p class="pd-head-sub">' + ic('shield') + '<span>Runs on this device. Nothing is uploaded.</span></p></div></header>' +
      '<div class="pd-body"><div class="pd-main"></div><aside class="pd-side" aria-label="Preview"></aside></div>' +
      '<footer class="pd-foot"><p class="pd-foot-msg" aria-live="polite"></p><div class="pd-foot-acts"></div></footer>';
    d.body.appendChild(W);
    $('.pd-close', W).addEventListener('click', close);
    W.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    return W;
  }
  function open(title, kind) {
    var w = workbench();
    if (current && current.destroy) current.destroy();
    $('#pd-work-title', w).textContent = title;
    w.setAttribute('data-kind', kind);
    var ctx = { main: $('.pd-main', w), side: $('.pd-side', w), acts: $('.pd-foot-acts', w), msg: $('.pd-foot-msg', w) };
    ctx.main.innerHTML = ''; ctx.side.innerHTML = ''; ctx.acts.innerHTML = ''; ctx.msg.textContent = '';
    w.hidden = false;
    d.body.classList.add('pd-open');
    if (PS.isPhone && PS.isPhone() && PS.setSheet) PS.setSheet('closed');
    setTimeout(function () { var f = $('.pd-close', w); if (f) f.focus(); }, 30);
    return ctx;
  }
  function close() {
    if (!W) return;
    if (current && current.destroy) current.destroy();
    current = null;
    $('.pd-main', W).innerHTML = '';
    $('.pd-side', W).innerHTML = '';
    W.hidden = true;
    d.body.classList.remove('pd-open');
    refreshPanel();
  }
  function primary(ctx, label, onClick) { var b = btn('btn btn-gold pd-go', esc(label), onClick); ctx.acts.appendChild(b); return b; }
  function secondary(ctx, label, onClick) { var b = btn('btn btn-ghost', esc(label), onClick); ctx.acts.appendChild(b); return b; }

  /* pdf.js page → canvas (preview) */
  function renderPage(bytes, pageIndex, width) {
    return (LE.pdf && LE.pdf.ready ? LE.pdf.ready() : Promise.resolve()).then(function () {
      return global.pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    }).then(function (pdf) {
      var n = pdf.numPages;
      return pdf.getPage(Math.min(n, pageIndex + 1)).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 });
        var dpr = Math.min(2, global.devicePixelRatio || 1);
        var scale = width / vp1.width;
        var vp = page.getViewport({ scale: scale * dpr });
        var c = d.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        c.style.width = Math.round(vp1.width * scale) + 'px';
        c.style.height = Math.round(vp1.height * scale) + 'px';
        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
          var out = { canvas: c, pages: n, scale: scale, w: vp1.width, h: vp1.height };
          page.cleanup(); pdf.destroy();
          return out;
        });
      });
    });
  }

  /* =================== invoice / quote / receipt editor =================== */

  function readLogo(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type) || file.size > 15e6) { reject(new Error('Choose a PNG or JPEG image under 15 MB.')); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = d.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var png = c.toDataURL('image/png');
        resolve(png.length < 450000 ? png : c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  }

  function openEditor(input) {
    var ctx = open('', 'editor');
    var st = { doc: D.sanitize(input), timer: 0, tok: 0, remember: true, last: null };
    var main = ctx.main;

    function changed(rebuild) {
      if (rebuild) build();
      clearTimeout(st.timer);
      st.timer = setTimeout(preview, 380);
      totalsBox();
    }
    function bind(el, key, obj) {
      function set() { (obj ? obj() : st.doc)[key] = el.value; changed(false); }
      el.addEventListener('input', set);
      el.addEventListener('change', set);
    }

    function build() {
      main.innerHTML = '';
      var doc = st.doc;
      var ty = D.TYPES[doc.type];
      $('#pd-work-title', W).textContent = ty.title + (doc.number ? ' ' + doc.number : '');

      /* 1. document */
      var s1 = section('Document');
      var row = h('div', 'pd-row');
      var typeF = field('Type', 'select', doc.type, { options: JOBS.map(function (j) { return [j.id, j.title]; }) });
      typeF.input.addEventListener('change', function () {
        var old = st.doc.type;
        st.doc.type = typeF.input.value;
        if (!st.doc.numberUsed && st.doc.number === D.store.peekNumber(old, st.doc.issued)) st.doc.number = D.store.peekNumber(st.doc.type, st.doc.issued);
        if (!D.TYPES[st.doc.type].terms) { st.doc.terms = ''; st.doc.due = ''; }
        else if (st.doc.type === 'invoice' && st.doc.terms === '') { st.doc.terms = '14'; st.doc.due = D.dueFrom(st.doc.issued, '14'); }
        changed(true);
      });
      row.appendChild(typeF);
      var numF = field('Number', 'text', doc.number, { key: 'number' });
      bind(numF.input, 'number');
      numF.input.addEventListener('input', function () { $('#pd-work-title', W).textContent = ty.title + ' ' + numF.input.value; });
      row.appendChild(numF);
      s1.appendChild(row);
      var numbering = h('details', 'pd-more');
      numbering.appendChild(h('summary', null, 'Numbering'));
      var patF = field('Pattern for new ' + ty.title.toLowerCase() + 's', 'text', D.store.pattern(doc.type), { hint: '{YYYY} year, {YY}, {MM}, {DD}, and {###} for the running number. Next: ' + D.store.peekNumber(doc.type, doc.issued) });
      var cntF = field('Last number used', 'number', String(D.store.counter(doc.type)), { inputmode: 'numeric' });
      numbering.appendChild(patF);
      numbering.appendChild(cntF);
      numbering.appendChild(btn('btn btn-sm', 'Use for the next number', function () {
        D.store.pattern(st.doc.type, patF.input.value);
        D.store.setCounter(st.doc.type, cntF.input.value);
        if (!st.doc.numberUsed) st.doc.number = D.store.peekNumber(st.doc.type, st.doc.issued);
        changed(true);
        say('Numbering saved on this device');
      }));
      s1.appendChild(numbering);
      var row2 = h('div', 'pd-row');
      var issF = field(doc.type === 'receipt' ? 'Date received' : 'Date', 'date', doc.issued);
      issF.input.addEventListener('change', function () { st.doc.issued = issF.input.value; if (st.doc.terms !== '' && st.doc.type === 'invoice') st.doc.due = D.dueFrom(st.doc.issued, st.doc.terms); changed(true); });
      row2.appendChild(issF);
      if (doc.type === 'invoice') {
        var termF = field('Payment terms', 'select', doc.terms, { options: [['0', 'Due on receipt'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days'], ['45', '45 days'], ['60', '60 days'], ['', 'Pick a due date']] });
        termF.input.addEventListener('change', function () { st.doc.terms = termF.input.value; if (st.doc.terms !== '') st.doc.due = D.dueFrom(st.doc.issued, st.doc.terms); changed(true); });
        row2.appendChild(termF);
      }
      s1.appendChild(row2);
      if (ty.dateLabel) {
        var dueF = field(ty.dateLabel, 'date', doc.due);
        if (doc.type === 'invoice' && doc.terms !== '') dueF.input.readOnly = true;
        bind(dueF.input, 'due');
        s1.appendChild(dueF);
      }
      var refF = field('Reference or PO (optional)', 'text', doc.reference);
      bind(refF.input, 'reference');
      s1.appendChild(refF);
      main.appendChild(s1);

      /* 2. from */
      var s2 = section('From', 'your business');
      var biz = function () { return st.doc.business; };
      [['name', 'Business name', 'text'], ['address', 'Address', 'textarea'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['website', 'Website', 'text']].forEach(function (f) {
        var x = field(f[1], f[2], doc.business[f[0]], { rows: 2, key: 'business.' + f[0] });
        bind(x.input, f[0], biz);
        s2.appendChild(x);
      });
      var reg = h('div', 'pd-row');
      var rl = field('Registration label', 'text', doc.business.regLabel, { placeholder: 'e.g. VAT no., GSTIN, ABN' });
      var rv = field('Registration number', 'text', doc.business.regValue);
      bind(rl.input, 'regLabel', biz);
      bind(rv.input, 'regValue', biz);
      reg.appendChild(rl);
      reg.appendChild(rv);
      s2.appendChild(reg);
      var logoRow = h('div', 'pd-logo');
      if (doc.logo) logoRow.appendChild(h('img', 'pd-logo-img', null, { src: doc.logo, alt: 'Your logo' }));
      logoRow.appendChild(btn('btn btn-sm', esc(doc.logo ? 'Change logo' : 'Add a logo'), function () {
        PS.pickFiles('image/png,image/jpeg,image/webp', false).then(function (files) {
          if (!files[0]) return;
          return readLogo(files[0]).then(function (url) { st.doc.logo = url; changed(true); });
        }).catch(function (e) { say(e.message, 4200); });
      }));
      if (doc.logo) logoRow.appendChild(btn('btn btn-sm btn-ghost', 'Remove logo', function () { st.doc.logo = ''; changed(true); }));
      s2.appendChild(logoRow);
      var rem = h('label', 'pd-check', '<input type="checkbox"' + (st.remember ? ' checked' : '') + '><span>Remember my business details on this device</span>');
      $('input', rem).addEventListener('change', function (e) { st.remember = e.target.checked; });
      s2.appendChild(rem);
      main.appendChild(s2);

      /* 3. to */
      var s3 = section(doc.type === 'receipt' ? 'Received from' : 'Client');
      var clients = D.store.clients();
      if (clients.length) {
        var pick = field('Saved clients', 'select', '', { options: [['', 'Choose a saved client…']].concat(clients.map(function (c) { return [c.id, c.name + (c.email ? ' · ' + c.email : '')]; })) });
        pick.input.setAttribute('data-k', 'client-pick');
        pick.input.addEventListener('change', function () {
          var c = clients.filter(function (x) { return x.id === pick.input.value; })[0];
          if (c) { st.doc.client = Object.assign({}, c); changed(true); }
        });
        s3.appendChild(pick);
      }
      var cli = function () { return st.doc.client; };
      [['name', 'Name', 'text'], ['contact', 'Contact person (optional)', 'text'], ['address', 'Address', 'textarea'], ['email', 'Email', 'email'], ['taxId', (doc.business.regLabel || 'Tax ID') + ' (optional)', 'text']].forEach(function (f) {
        var x = field(f[1], f[2], doc.client[f[0]], { rows: 2, key: 'client.' + f[0] });
        bind(x.input, f[0], cli);
        s3.appendChild(x);
      });
      s3.appendChild(btn('btn btn-sm', 'Save to client list', function () {
        try { var saved = D.store.saveClient(st.doc.client); st.doc.client.id = saved.id; say(saved.name + ' saved on this device'); changed(true); }
        catch (e) { say(e.message, 3600); }
      }, { 'data-act': 'save-client' }));
      main.appendChild(s3);

      /* 4. items */
      var s4 = section('Items');
      var list = h('div', 'pd-items');
      doc.items.forEach(function (it, i) {
        var card = h('div', 'pd-item');
        var item = function () { return st.doc.items[i]; };
        var desc = field('Line ' + (i + 1) + ' description', 'textarea', it.description, { rows: 2, cls: 'pd-item-desc', key: 'item.description' });
        bind(desc.input, 'description', item);
        card.appendChild(desc);
        var nums = h('div', 'pd-item-nums');
        var q = field('Qty', 'text', it.qty, { inputmode: 'decimal', key: 'item.qty' }); bind(q.input, 'qty', item);
        var p = field('Unit price', 'text', it.price, { inputmode: 'decimal', placeholder: '0.00', key: 'item.price' }); bind(p.input, 'price', item);
        var dsc = field('Discount', 'text', it.discount, { placeholder: '10% or 5.00', key: 'item.discount' }); bind(dsc.input, 'discount', item);
        nums.appendChild(q); nums.appendChild(p); nums.appendChild(dsc);
        if (doc.tax.mode === 'line') { var tx = field('Tax %', 'text', it.tax, { inputmode: 'decimal', key: 'item.tax' }); bind(tx.input, 'tax', item); nums.appendChild(tx); }
        card.appendChild(nums);
        var acts = h('div', 'pd-item-acts');
        if (i > 0) acts.appendChild(btn('ps-ib', PS.icon('up'), function () { var a = st.doc.items; var t = a[i - 1]; a[i - 1] = a[i]; a[i] = t; changed(true); }, { 'aria-label': 'Move line ' + (i + 1) + ' up' }));
        acts.appendChild(btn('ps-ib', PS.icon('copy'), function () { st.doc.items.splice(i + 1, 0, Object.assign({}, st.doc.items[i])); changed(true); }, { 'aria-label': 'Duplicate line ' + (i + 1) }));
        if (doc.items.length > 1) acts.appendChild(btn('ps-ib', PS.icon('trash'), function () { st.doc.items.splice(i, 1); changed(true); }, { 'aria-label': 'Remove line ' + (i + 1) }));
        card.appendChild(acts);
        list.appendChild(card);
      });
      s4.appendChild(list);
      s4.appendChild(btn('btn btn-sm', PS.icon('plus') + '<span>Add a line</span>', function () {
        if (st.doc.items.length >= 300) { say('300 lines is the limit for one document.'); return; }
        st.doc.items.push({ description: '', qty: '1', price: '', discount: '', tax: '' });
        changed(true);
        setTimeout(function () { var all = $$('.pd-item-desc textarea', main); if (all.length) all[all.length - 1].focus(); }, 30);
      }, { 'data-act': 'add-line' }));
      main.appendChild(s4);

      /* 5. money and tax */
      var s5 = section('Currency and tax');
      var cur = function () { return st.doc.currency; };
      var r5 = h('div', 'pd-row pd-row-3');
      var code = field('Currency code', 'text', doc.currency.code, { placeholder: 'e.g. EUR', key: 'currency.code' }); bind(code.input, 'code', cur);
      var sym = field('Symbol', 'text', doc.currency.symbol, { placeholder: 'e.g. €', key: 'currency.symbol' }); bind(sym.input, 'symbol', cur);
      var decF = field('Decimals', 'select', String(doc.currency.decimals), { options: [['2', '2'], ['0', '0'], ['3', '3']] });
      decF.input.addEventListener('change', function () { st.doc.currency.decimals = Number(decF.input.value); changed(false); });
      r5.appendChild(code); r5.appendChild(sym); r5.appendChild(decF);
      s5.appendChild(r5);
      var r6 = h('div', 'pd-row');
      r6.appendChild(seg('Symbol goes', [['before', 'Before'], ['after', 'After']], doc.currency.place === 'after' ? 'after' : 'before', function (v) { st.doc.currency.place = v; changed(false); }));
      var styleF = field('Number style', 'select', doc.currency.style || 'en', { options: [['en', '1,234.56'], ['eu', '1.234,56'], ['space', '1\u202F234,56'], ['ch', '1’234.56'], ['in', '12,34,567.89']] });
      styleF.input.addEventListener('change', function () { st.doc.currency.style = styleF.input.value; changed(false); });
      r6.appendChild(styleF);
      s5.appendChild(r6);
      s5.appendChild(h('p', 'pd-hint', 'Type amounts with the decimal mark of the number style you chose. The currency is never guessed.'));
      s5.appendChild(seg('Tax', [['none', 'No tax'], ['doc', 'One rate'], ['line', 'Per line']], doc.tax.mode, function (v) { st.doc.tax.mode = v; changed(true); }));
      if (doc.tax.mode !== 'none') {
        var r7 = h('div', 'pd-row');
        var pre = field('Tax label', 'select', doc.tax.preset && doc.tax.preset !== 'none' ? doc.tax.preset : 'custom', { options: D.TAX_PRESETS.filter(function (p) { return p.id !== 'none'; }).map(function (p) { return [p.id, p.id === 'gst-split' ? 'GST as CGST + SGST' : p.id === 'gst-igst' ? 'IGST' : p.id === 'custom' ? 'My own label' : p.label]; }) });
        pre.input.setAttribute('data-k', 'tax.preset');
        if (!doc.tax.preset || doc.tax.preset === 'none') st.doc.tax.preset = 'custom';
        pre.input.addEventListener('change', function () {
          st.doc.tax.preset = pre.input.value;
          var p = D.TAX_PRESETS.filter(function (x) { return x.id === pre.input.value; })[0];
          if (p && p.id !== 'custom') st.doc.tax.label = p.label;
          if (p && p.regLabel && !st.doc.business.regLabel) st.doc.business.regLabel = p.regLabel;
          changed(true);
        });
        r7.appendChild(pre);
        if (st.doc.tax.preset === 'custom') { var lab = field('Label', 'text', doc.tax.label, { placeholder: 'e.g. HST' }); bind(lab.input, 'label', function () { return st.doc.tax; }); r7.appendChild(lab); }
        if (doc.tax.mode === 'doc') { var rate = field('Rate %', 'text', doc.tax.rate, { inputmode: 'decimal', placeholder: 'e.g. 20', key: 'tax.rate' }); bind(rate.input, 'rate', function () { return st.doc.tax; }); r7.appendChild(rate); }
        s5.appendChild(r7);
        var incl = h('label', 'pd-check', '<input type="checkbox"' + (doc.tax.inclusive ? ' checked' : '') + '><span>Prices already include tax</span>');
        $('input', incl).addEventListener('change', function (e) { st.doc.tax.inclusive = e.target.checked; changed(false); });
        s5.appendChild(incl);
        s5.appendChild(h('p', 'pd-hint', 'Tax names and rates are labels you choose. LocalEditor gives no tax advice; check rates and wording with your accountant.'));
      }
      var r8 = h('div', 'pd-row');
      var dd = field('Discount on the total', 'text', doc.discount, { placeholder: '5% or 50.00', key: 'discount' }); bind(dd.input, 'discount');
      r8.appendChild(dd);
      if (doc.type === 'invoice' || doc.type === 'receipt') { var paid = field(doc.type === 'receipt' ? 'Amount received' : 'Already paid', 'text', doc.paid, { inputmode: 'decimal', placeholder: doc.type === 'receipt' ? 'the total' : '0.00', key: 'paid' }); bind(paid.input, 'paid'); r8.appendChild(paid); }
      s5.appendChild(r8);
      main.appendChild(s5);

      /* 6. notes and payment */
      var s6 = section('Payment and notes');
      var pay = field('Payment details', 'textarea', doc.payment || doc.business.payment, { rows: 3, placeholder: 'Bank, account, reference to quote…', key: 'payment' }); bind(pay.input, 'payment');
      if (!doc.payment && doc.business.payment) st.doc.payment = doc.business.payment;
      var notes = field('Notes', 'textarea', doc.notes, { rows: 3, key: 'notes' }); bind(notes.input, 'notes');
      var qr = field('Payment QR code (optional)', 'text', doc.qr, { placeholder: 'A payment link or UPI string you were given', hint: 'Exactly what you type goes into the QR code. Nothing is checked or sent anywhere.', key: 'qr' }); bind(qr.input, 'qr');
      var qrl = field('Words under the QR code', 'text', doc.qrLabel, { placeholder: 'Scan to pay' }); bind(qrl.input, 'qrLabel');
      [pay, notes, qr, qrl].forEach(function (x) { s6.appendChild(x); });
      main.appendChild(s6);

      /* 7. look */
      var s7 = section('Look');
      var tg = h('div', 'pd-tpls', null, { role: 'radiogroup', 'aria-label': 'Template' });
      D.TEMPLATES.forEach(function (t) {
        var on = (doc.template || 'classic') === t.id;
        tg.appendChild(btn('pd-tpl', '<span class="pd-tpl-sw" style="background:' + esc(t.accent) + '"></span><span>' + esc(t.name) + '</span>', function () { st.doc.template = t.id; st.doc.accent = ''; changed(true); }, { role: 'radio', 'aria-checked': String(on), 'data-tpl': t.id }));
      });
      s7.appendChild(tg);
      var r9 = h('div', 'pd-row');
      var acc = field('Accent colour', 'color', doc.accent || (D.TEMPLATES.filter(function (t) { return t.id === doc.template; })[0] || D.TEMPLATES[0]).accent);
      acc.input.addEventListener('input', function () { st.doc.accent = acc.input.value; changed(false); });
      r9.appendChild(acc);
      r9.appendChild(seg('Paper', [['A4', 'A4'], ['Letter', 'Letter']], doc.paper, function (v) { st.doc.paper = v; changed(false); }));
      s7.appendChild(r9);
      main.appendChild(s7);
      main.appendChild(h('p', 'pd-private', ic('shield') + '<span>A document maker, not accounting software. Drafts, clients and your details are kept only in this browser on this device.</span>'));
    }

    /* side: live preview and totals */
    var pv = h('div', 'pd-preview');
    var stage = h('div', 'pd-stage', '<p class="pd-hint">The preview appears here.</p>');
    var tbox = h('div', 'pd-totals', null, { 'aria-live': 'polite' });
    pv.appendChild(tbox);
    pv.appendChild(stage);
    pv.appendChild(h('details', 'pd-more pd-rules', '<summary>How totals are worked out</summary><ol><li>Each line is quantity × unit price, rounded to the cent (the smallest unit of the currency).</li><li>A line discount comes off that line. A discount on the total is shared across tax rates exactly.</li><li>Tax is worked out once per rate on the taxed amount and rounded half away from zero. CGST and SGST are each rounded on their own.</li><li>Everything is added up in whole cents, so the figures always add up.</li></ol>'));
    ctx.side.appendChild(pv);

    function totalsBox() {
      var t = D.totals(st.doc);
      var cur = st.doc.currency;
      var rows = [['Subtotal', t.subtotal]];
      if (t.discount) rows.push(['Discount', -t.discount]);
      t.taxes.forEach(function (x) { rows.push([x.label + ' ' + D.formatRate(x.rate) + (t.inclusive ? ' incl.' : ''), x.amount]); });
      rows.push(['Total', t.total]);
      if (st.doc.type === 'invoice' && t.paid) rows.push(['Balance due', t.due]);
      tbox.innerHTML = '<dl>' + rows.map(function (r) { return '<div' + (r[0] === 'Total' ? ' class="is-total"' : '') + '><dt>' + esc(r[0]) + '</dt><dd>' + esc(D.formatMoney(r[1], cur)) + '</dd></div>'; }).join('') + '</dl>' +
        (t.errors.length ? '<p class="pd-bad">' + esc(t.errors.length === 1 ? 'One amount could not be read' : t.errors.length + ' amounts could not be read') + (t.errors[0].line != null ? ' (line ' + (t.errors[0].line + 1) + ', ' + t.errors[0].field + ')' : '') + '. Check the number style.</p>' : '');
    }
    function preview() {
      var tok = ++st.tok;
      ctx.msg.textContent = 'Updating the preview…';
      D.render(st.doc).then(function (res) {
        if (tok !== st.tok) return;
        st.last = res;
        return renderPage(res.bytes, 0, Math.min(440, (stage.clientWidth || 340) - 2)).then(function (r) {
          if (tok !== st.tok) return;
          stage.innerHTML = '';
          r.canvas.setAttribute('role', 'img');
          r.canvas.setAttribute('aria-label', 'Preview of page 1');
          stage.appendChild(r.canvas);
          ctx.msg.textContent = res.pageCount + ' page' + (res.pageCount === 1 ? '' : 's') + ' · ' + fmtBytes(res.bytes.length) + ' · text can be selected and searched';
        });
      }).catch(function (e) { if (tok === st.tok) ctx.msg.textContent = 'Preview failed: ' + (e && e.message ? e.message : e); });
    }

    function persist(quiet) {
      if (st.remember) {
        var b = Object.assign({}, st.doc.business, { logo: st.doc.logo || '' });
        if (st.doc.payment) b.payment = st.doc.payment;
        D.store.business(b);
      }
      D.store.prefs({ currency: JSON.stringify(st.doc.currency), template: st.doc.template, accent: st.doc.accent, paper: st.doc.paper, taxPreset: st.doc.tax.preset, taxMode: st.doc.tax.mode, taxRate: st.doc.tax.rate });
      try { st.doc = D.store.saveDraft(st.doc); if (!quiet) say('Saved on this device'); return true; }
      catch (e) { say(e.message, 4800); return false; }
    }
    secondary(ctx, 'Save draft', function () { persist(false); }).setAttribute('data-act', 'save-draft');
    secondary(ctx, 'Duplicate as new', function () {
      persist(true);
      var copy = D.sanitize(st.doc);
      copy.id = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      copy.numberUsed = false;
      copy.issued = isoToday();
      copy.number = D.store.peekNumber(copy.type, copy.issued);
      if (copy.terms !== '') copy.due = D.dueFrom(copy.issued, copy.terms);
      copy.paid = '';
      try { st.doc = D.store.saveDraft(copy); } catch (e) { st.doc = copy; }
      changed(true);
      say('A new copy, numbered ' + copy.number);
    }).setAttribute('data-act', 'duplicate');
    primary(ctx, 'Download PDF', function () {
      var t = D.totals(st.doc);
      if (t.errors.length) { say('Fix the amounts marked in the totals first.', 4200); return; }
      ctx.msg.textContent = 'Making the PDF…';
      D.render(st.doc).then(function (res) {
        if (!st.doc.numberUsed) { D.store.useNumber(st.doc.type, st.doc.number); st.doc.numberUsed = true; }
        persist(true);
        download(new Blob([res.bytes], { type: 'application/pdf' }), D.fileName(st.doc));
        ctx.msg.textContent = 'Downloaded · ' + fmtBytes(res.bytes.length) + ' · saved on this device';
      }).catch(function (e) { ctx.msg.textContent = 'Could not make the PDF: ' + (e && e.message ? e.message : e); });
    }).setAttribute('data-act', 'download');

    build();
    totalsBox();
    setTimeout(preview, 60);
    current = { destroy: function () { clearTimeout(st.timer); st.tok++; }, state: st };
    PS.docs.current = current;
  }

  /* =================== client list =================== */

  function openClients() {
    var ctx = open('Client list', 'clients');
    function render() {
      ctx.main.innerHTML = '';
      var list = D.store.clients();
      var s = section('Saved clients', list.length + ' on this device');
      if (!list.length) s.appendChild(h('p', 'pd-hint', 'Clients you save from an invoice or quote appear here.'));
      var ul = h('ul', 'pd-drafts');
      list.forEach(function (c) {
        var li = h('li', 'pd-draft');
        li.appendChild(h('div', 'pd-draft-open', '<strong>' + esc(c.name) + '</strong><small>' + esc([c.email, c.address && c.address.split('\n')[0]].filter(Boolean).join(' · ')) + '</small>'));
        li.appendChild(btn('ps-ib pd-draft-x', PS.icon('trash'), function () { if (global.confirm('Remove ' + c.name + ' from this device?')) { D.store.removeClient(c.id); render(); } }, { 'aria-label': 'Remove ' + c.name }));
        ul.appendChild(li);
      });
      s.appendChild(ul);
      ctx.main.appendChild(s);
      var s2 = section('Move or erase');
      var row = h('div', 'pd-acts');
      row.appendChild(btn('btn btn-sm', 'Export client list', function () {
        download(new Blob([D.store.exportClients()], { type: 'application/json' }), 'clients.json');
      }, { 'data-act': 'export-clients' }));
      row.appendChild(btn('btn btn-sm', 'Import a client list', function () {
        PS.pickFiles('.json,application/json', false).then(function (files) {
          if (!files[0]) return;
          if (files[0].size > 5e6) throw new Error('That file is too large to be a client list.');
          return files[0].text().then(function (t) { var r = D.store.importClients(t); say(r.added + ' added, ' + r.updated + ' updated' + (r.skipped ? ', ' + r.skipped + ' skipped' : '')); render(); });
        }).catch(function (e) { say(e.message, 4200); });
      }, { 'data-act': 'import-clients' }));
      row.appendChild(btn('btn btn-sm pd-danger', 'Erase all clients', function () {
        if (!global.confirm('Erase every saved client from this device? This cannot be undone.')) return;
        D.store.eraseClients(); render(); say('Client list erased');
      }, { 'data-act': 'erase-clients' }));
      row.appendChild(btn('btn btn-sm pd-danger', 'Erase everything saved here', function () {
        if (!global.confirm('Erase all drafts, clients, numbering and your business details from this device? This cannot be undone.')) return;
        D.store.eraseAll(); render(); say('All invoice data erased from this device');
      }, { 'data-act': 'erase-all' }));
      s2.appendChild(row);
      s2.appendChild(h('p', 'pd-hint', 'Kept only in this browser (about ' + fmtBytes(D.store.bytes()) + '). Export makes a file you can import on another device.'));
      ctx.main.appendChild(s2);
    }
    render();
    current = {};
  }

  /* =================== tables → spreadsheet =================== */

  function openDocBytes() {
    var ids = Object.keys(S.docs || {});
    if (!S.pages || !S.pages.length) return null;
    var name = PS.outName ? PS.outName() : 'document.pdf';
    if (ids.length === 1 && S.pages.length === S.docs[ids[0]].pageCount && !S.docs[ids[0]].encrypted) {
      var doc = S.docs[ids[0]];
      return Promise.resolve({ name: name, bytes: doc.bytes ? doc.bytes() : doc._bytes.slice(0) });
    }
    return Promise.resolve(PS.buildPdf({})).then(function (b) { return { name: name, bytes: b }; });
  }

  function openTables() {
    var ctx = open('Extract tables to a spreadsheet', 'tables');
    var st = { bytes: null, name: '', page: 0, pages: 0, tables: [], sel: -1, rect: null, scale: 1 };
    var main = ctx.main, side = ctx.side;
    main.appendChild(h('p', 'pd-callout', '<strong>Best effort — check the result.</strong> Tables are rebuilt from where the text sits on the page. Scanned pages have no text to read yet.'));
    var src = section('PDF');
    var srcRow = h('div', 'pd-acts');
    var srcName = h('p', 'pd-hint', 'No PDF chosen yet.');
    srcRow.appendChild(btn('btn btn-sm', PS.icon('filePlus') + '<span>Choose a PDF</span>', function () {
      PS.pickFiles('.pdf,application/pdf', false).then(function (files) {
        if (!files[0]) return;
        return files[0].arrayBuffer().then(function (b) { load(new Uint8Array(b), files[0].name); });
      });
    }, { 'data-act': 'choose-pdf' }));
    var useOpen = btn('btn btn-sm btn-ghost', PS.icon('file') + '<span>Use the open document</span>', function () {
      var job = openDocBytes();
      if (!job) return;
      job.then(function (r) { load(r.bytes, r.name); }, function (e) { say((e && e.message) || 'Could not read the open document', 4200); });
    }, { 'data-act': 'use-open' });
    useOpen.hidden = !(S.pages && S.pages.length);
    srcRow.appendChild(useOpen);
    src.appendChild(srcRow);
    src.appendChild(srcName);
    main.appendChild(src);

    var find = section('Find tables');
    var nav = h('div', 'pd-acts pd-nav');
    var prev = btn('ps-ib', PS.icon('left'), function () { go(st.page - 1); }, { 'aria-label': 'Previous page' });
    var pageLbl = h('span', 'pd-page', '');
    var next = btn('ps-ib', PS.icon('right'), function () { go(st.page + 1); }, { 'aria-label': 'Next page' });
    nav.appendChild(prev); nav.appendChild(pageLbl); nav.appendChild(next);
    find.appendChild(nav);
    var stage = h('div', 'pd-stage pd-pick', '<p class="pd-hint">Choose a PDF to see its pages.</p>');
    find.appendChild(stage);
    find.appendChild(h('p', 'pd-hint', 'Tap “Find on this page”, or drag a box around one table and tap “Read the box”.'));
    var fr = h('div', 'pd-acts');
    var findPage = btn('btn btn-sm', 'Find on this page', function () { run({ page: st.page }); }, { 'data-act': 'find-page' });
    var findAll = btn('btn btn-sm', 'Find in every page', function () { run({ page: 'all' }); }, { 'data-act': 'find-all' });
    var useBox = btn('btn btn-sm', 'Read the box', function () { if (st.rect) run({ page: st.page, rect: st.rect }); }, { 'data-act': 'use-box' });
    [findPage, findAll, useBox].forEach(function (b) { b.disabled = true; fr.appendChild(b); });
    find.appendChild(fr);
    main.appendChild(find);

    var res = section('Tables found');
    var resList = h('div', 'pd-tables');
    res.appendChild(resList);
    main.appendChild(res);
    var gridBox = h('div', 'pd-gridwrap');
    side.appendChild(gridBox);

    function load(bytes, name) {
      st.bytes = bytes; st.name = name; st.page = 0; st.tables = []; st.sel = -1; st.rect = null; st.pages = 0;
      srcName.textContent = name;
      findPage.disabled = findAll.disabled = false;
      renderResults();
      return go(0);
    }
    function go(p) {
      if (!st.bytes || p < 0 || (st.pages && p >= st.pages)) return Promise.resolve();
      st.page = p; st.rect = null; useBox.disabled = true;
      return renderPage(st.bytes, p, Math.min(560, (stage.clientWidth || 340) - 2)).then(function (r) {
        st.pages = r.pages; st.scale = r.scale;
        pageLbl.textContent = 'Page ' + (p + 1) + ' of ' + r.pages;
        prev.disabled = p === 0; next.disabled = p >= r.pages - 1;
        stage.innerHTML = '';
        var wrap = h('div', 'pd-canvas');
        wrap.appendChild(r.canvas);
        var overlay = h('div', 'pd-overlay', null, { 'aria-hidden': 'true' });
        wrap.appendChild(overlay);
        stage.appendChild(wrap);
        drawBoxes(overlay);
        dragBox(wrap, overlay);
      }).catch(function (e) { stage.innerHTML = '<p class="pd-bad">' + esc((e && e.message) || 'This PDF could not be shown.') + '</p>'; });
    }
    function drawBoxes(overlay) {
      st.tables.forEach(function (t, i) {
        if (t.pages[0] !== st.page) return;
        var b = h('div', 'pd-found' + (i === st.sel ? ' is-sel' : ''));
        b.style.left = (t.box.x * st.scale - 3) + 'px'; b.style.top = (t.box.y * st.scale - 3) + 'px';
        b.style.width = (t.box.w * st.scale + 6) + 'px'; b.style.height = (t.box.h * st.scale + 6) + 'px';
        overlay.appendChild(b);
      });
    }
    function dragBox(wrap, overlay) {
      var box = null, start = null;
      wrap.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        var r = wrap.getBoundingClientRect();
        start = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (box) box.remove();
        box = h('div', 'pd-drag');
        overlay.appendChild(box);
        try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      wrap.addEventListener('pointermove', function (e) {
        if (!start) return;
        var r = wrap.getBoundingClientRect();
        var x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
        var x0 = Math.min(start.x, x), y0 = Math.min(start.y, y);
        box.style.left = x0 + 'px'; box.style.top = y0 + 'px'; box.style.width = Math.abs(x - start.x) + 'px'; box.style.height = Math.abs(y - start.y) + 'px';
        st.rect = { x: x0 / st.scale, y: y0 / st.scale, w: Math.abs(x - start.x) / st.scale, h: Math.abs(y - start.y) / st.scale };
      });
      function end() {
        if (!start) return;
        start = null;
        if (st.rect && st.rect.w > 8 && st.rect.h > 8) { useBox.disabled = false; ctx.msg.textContent = 'Box drawn. Tap “Read the box”.'; }
        else { st.rect = null; if (box) box.remove(); useBox.disabled = true; }
      }
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);
    }
    function run(opts) {
      if (!st.bytes) return Promise.resolve();
      ctx.msg.textContent = 'Reading text positions…';
      return D.extractTables(st.bytes, opts).then(function (tables) {
        if (opts.page === 'all') st.tables = tables.slice();
        else st.tables = st.tables.filter(function (t) { return t.pages[0] !== st.page; }).concat(tables);
        st.tables.sort(function (a, b) { return a.page - b.page || a.box.y - b.box.y; });
        st.tables.forEach(function (t) { if (!t.types) t.types = D.columnTypes(t); });
        st.sel = tables.length ? st.tables.indexOf(tables[0]) : (st.tables.length ? 0 : -1);
        var scanned = tables.scannedPages && tables.scannedPages === tables.pageCount;
        ctx.msg.textContent = tables.length ? tables.length + ' table' + (tables.length === 1 ? '' : 's') + ' found. Check each one before you export.' : scanned ? 'No text here: the page looks scanned. Scanned pages cannot be read yet.' : 'No table found. Try dragging a box around it.';
        renderResults();
        return go(tables.length ? tables[0].pages[0] : st.page);
      }).catch(function (e) { ctx.msg.textContent = 'Could not read this PDF: ' + (e && e.message ? e.message : e); });
    }
    function renderResults() {
      resList.innerHTML = '';
      if (!st.tables.length) { resList.appendChild(h('p', 'pd-hint', 'None yet.')); gridBox.innerHTML = ''; setActs(); return; }
      st.tables.forEach(function (t, i) {
        var label = 'Table ' + (i + 1) + ' · page ' + (t.pages[0] + 1) + (t.pages.length > 1 ? '–' + (t.pages[t.pages.length - 1] + 1) : '') + ' · ' + (t.rows[0] || []).length + ' columns × ' + t.rows.length + ' rows';
        resList.appendChild(btn('pd-tbl' + (i === st.sel ? ' is-sel' : ''), esc(label), function () { st.sel = i; renderResults(); go(t.pages[0]); }, { 'aria-pressed': String(i === st.sel), 'data-table': String(i) }));
      });
      renderGrid();
      setActs();
    }
    function cur() { return st.tables[st.sel] || null; }
    function renderGrid() {
      var t = cur();
      gridBox.innerHTML = '';
      if (!t) return;
      gridBox.appendChild(h('h3', 'pd-sec-title', 'Table ' + (st.sel + 1) + '<small>tap a cell to fix it</small>'));
      var hd = h('label', 'pd-check', '<input type="checkbox"' + (t.header ? ' checked' : '') + '><span>First row is a header</span>');
      $('input', hd).addEventListener('change', function (e) { t.header = e.target.checked; t.types = D.columnTypes(t); renderGrid(); });
      gridBox.appendChild(hd);
      var n = (t.rows[0] || []).length;
      var tbl = h('table', 'pd-grid');
      var ctl = h('tr', 'pd-grid-ctl');
      for (var c = 0; c < n; c++) {
        (function (c) {
          var th = h('th', null, null, { scope: 'col' });
          th.appendChild(btn('pd-type', t.types[c] === 'number' ? '123 Number' : 'Abc Text', function () { t.types[c] = t.types[c] === 'number' ? 'text' : 'number'; renderGrid(); }, { 'aria-label': 'Column ' + (c + 1) + ': ' + t.types[c] + '. Switch', 'data-col-type': String(c) }));
          var row = h('span', 'pd-colacts');
          row.appendChild(btn('ps-ib', ic('split'), function () { splitCol(t, c); renderGrid(); }, { 'aria-label': 'Split column ' + (c + 1), title: 'Split this column', 'data-split': String(c) }));
          if (c < n - 1) row.appendChild(btn('ps-ib', ic('merge'), function () { mergeCol(t, c); renderGrid(); }, { 'aria-label': 'Merge column ' + (c + 1) + ' with the next', title: 'Merge with the next column', 'data-merge': String(c) }));
          th.appendChild(row);
          ctl.appendChild(th);
        })(c);
      }
      var thead = h('thead'); thead.appendChild(ctl); tbl.appendChild(thead);
      var tb = h('tbody');
      t.rows.forEach(function (r, ri) {
        var tr = h('tr', ri === 0 && t.header ? 'is-head' : '');
        r.forEach(function (v, ci) {
          var td = h('td', t.types[ci] === 'number' && !(ri === 0 && t.header) ? 'is-num' : '', null, { contenteditable: 'true', spellcheck: 'false' });
          td.textContent = v;
          td.addEventListener('input', function () { t.rows[ri][ci] = td.textContent; });
          td.addEventListener('paste', function (e) { e.preventDefault(); var txt = (e.clipboardData || global.clipboardData).getData('text/plain'); d.execCommand('insertText', false, txt.replace(/\s+/g, ' ')); });
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      var scroller = h('div', 'pd-grid-scroll');
      scroller.appendChild(tbl);
      gridBox.appendChild(scroller);
    }
    function mergeCol(t, c) {
      t.rows.forEach(function (r) { r.splice(c, 2, [r[c], r[c + 1]].filter(function (x) { return x; }).join(' ')); });
      t.types.splice(c, 2, D.columnTypes(t)[c]);
    }
    function splitCol(t, c) {
      /* each cell splits at a double space; else after a leading code or number ("004100 Copy paper"); else at its last space */
      t.rows.forEach(function (r) {
        var v = String(r[c] || '');
        var m = /^(.*?\S)\s{2,}(\S.*)$/.exec(v) || /^([^\s]*\d[^\s]*)\s+(.*[^\d\s].*)$/.exec(v) || /^(.*\S)\s+(\S+)$/.exec(v);
        r.splice(c, 1, m ? m[1] : v, m ? m[2] : '');
      });
      var auto = D.columnTypes(t);
      t.types.splice(c, 1, auto[c], auto[c + 1]);
    }
    function baseName() { return String(st.name || 'tables').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'tables'; }
    var actsMade = false;
    function setActs() {
      if (!actsMade) {
        actsMade = true;
        secondary(ctx, 'Download CSV', function () {
          var t = cur();
          if (!t) return;
          download(new Blob([D.toCsv(t.rows)], { type: 'text/csv;charset=utf-8' }), baseName() + '-table-' + (st.sel + 1) + '.csv');
        }).setAttribute('data-act', 'csv');
        primary(ctx, 'Download Excel', function () {
          if (!st.tables.length) return;
          D.toXlsx(st.tables.map(function (t, i) { return { name: 'Table ' + (i + 1) + ' p' + (t.pages[0] + 1), rows: t.rows, types: t.types, header: t.header }; })).then(function (bytes) {
            download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), baseName() + '-tables.xlsx');
          }, function (e) { say('Could not make the spreadsheet: ' + e.message, 4200); });
        }).setAttribute('data-act', 'xlsx');
      }
      $$('button', ctx.acts).forEach(function (b) { b.disabled = !st.tables.length; });
    }
    setActs();
    current = { state: st, load: load, run: run };
    PS.docs.current = current;
    if (S.pages && S.pages.length) useOpen.click();
  }

  PS.docs = { openEditor: openEditor, openTables: openTables, openClients: openClients, close: close, current: null };

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { setTimeout(addEntryPoints, 0); });
  else setTimeout(addEntryPoints, 0);
})(typeof window !== 'undefined' ? window : globalThis);
