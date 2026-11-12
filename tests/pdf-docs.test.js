/* Business documents in the PDF studio: invoice / quote / receipt maker (D17) and tables to a spreadsheet (D18).
   LE.pdfDocs and the studio's "Docs" area. Table fixtures come from tests/fixtures/pdf-docs/make-fixtures.js. */
'use strict';
const path = require('path');

const FX = path.join(__dirname, 'fixtures', 'pdf-docs');

async function studio(h, browser, base, vp) {
  const page = await h.open(browser, base, '/pdf-studio/', vp || 'desktop');
  page.setDefaultTimeout(30000);
  page.foreign = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) page.foreign.push(u); });
  page.on('dialog', (dlg) => dlg.accept());
  await page.waitForFunction(() => window.LE && LE.pdfDocs && window.PS && PS.docs);
  await page.evaluate(() => {
    window.__fx = async (n) => new Uint8Array(await (await fetch('/tests/fixtures/pdf-docs/' + n)).arrayBuffer());
    window.__read = async (bytes) => {
      await LE.pdf.ready();
      const d = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
      const out = { pages: d.numPages, text: [], images: 0, title: (await d.getMetadata()).info.Title || '' };
      for (let i = 1; i <= d.numPages; i++) {
        const p = await d.getPage(i);
        out.text.push((await p.getTextContent()).items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join(''));
        (await p.getOperatorList()).fnArray.forEach((f) => { if (f === pdfjsLib.OPS.paintImageXObject) out.images++; });
      }
      d.destroy();
      return out;
    };
  });
  return page;
}
const flat = (s) => String(s).replace(/[\s\u00A0\u202F]+/g, ' ').trim();

const cases = {};

/* ---------------- D17: arithmetic ---------------- */

cases['D17: money is exact in whole cents (0.1 + 0.2, 1,000 lines, half-up rounding, discounts, split tax, inclusive tax)'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(() => {
    const D = LE.pdfDocs;
    const cur = { decimals: 2, style: 'en', symbol: '$' };
    const T = (items, tax, extra) => D.totals(Object.assign({ type: 'invoice', currency: cur, items, tax: tax || { mode: 'none' } }, extra || {}));
    const out = {};
    out.pointThree = T([{ qty: '1', price: '0.1' }, { qty: '1', price: '0.2' }]);
    const many = []; for (let i = 0; i < 1000; i++) many.push({ qty: '3', price: '0.01' });
    out.many = T(many);
    out.third = T([{ qty: '0.333', price: '3' }]);                    /* 0.999 → 1.00 */
    out.half = T([{ qty: '1', price: '0.125' }]);                     /* 0.125 → 0.13 (half away from zero) */
    out.neg = T([{ qty: '-1', price: '0.125' }]);                     /* → -0.13 */
    out.lineDisc = T([{ qty: '1', price: '33.33', discount: '10%' }, { qty: '2', price: '5', discount: '1.50' }]);
    out.split = T([{ qty: '1', price: '0.05' }], { mode: 'doc', preset: 'gst-split', rate: '18' });
    out.igst = T([{ qty: '1', price: '0.05' }], { mode: 'doc', preset: 'gst-igst', rate: '18' });
    out.splitBig = T([{ qty: '1', price: '1234.57' }], { mode: 'doc', preset: 'gst-split', rate: '18' });
    out.rates = T([{ qty: '1', price: '100', tax: '5' }, { qty: '1', price: '200', tax: '12' }, { qty: '1', price: '300.03', tax: '18' }], { mode: 'line', preset: 'vat' }, { discount: '10.01' });
    out.incl = T([{ qty: '1', price: '118' }], { mode: 'doc', preset: 'vat', rate: '18', inclusive: true });
    out.paid = T([{ qty: '2', price: '49.995' }], { mode: 'none' }, { paid: '50' });
    out.eu = D.parseAmount('1.234,56', 2, ','); out.en = D.parseAmount('1,234.56', 2, '.'); out.bad = T([{ qty: 'two', price: 'abc' }]).errors.length;
    out.huge = T([{ qty: '1000000', price: '99999999999' }]).errors.map((e) => e.reason);
    out.fmt = [D.formatMoney(-13, cur), D.formatMoney(123456789, { decimals: 2, style: 'in', symbol: '₹' }), D.formatMoney(123456, { decimals: 2, style: 'eu', symbol: '€', place: 'after' }), D.formatMoney(1234, { decimals: 0, style: 'en', code: 'JPY' })];
    /* property test: totals always add up in integers */
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let bad = 0;
    for (let k = 0; k < 400; k++) {
      const items = []; const n = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) items.push({ qty: (Math.floor(rnd() * 5000) / 1000).toString(), price: (Math.floor(rnd() * 1e6) / 100).toFixed(2), discount: rnd() < 0.3 ? Math.floor(rnd() * 30) + '%' : '', tax: [0, 5, 12, 18, 20][Math.floor(rnd() * 5)] + '' });
      const t = T(items, { mode: 'line', preset: rnd() < 0.5 ? 'gst-split' : 'vat' }, { discount: rnd() < 0.5 ? (rnd() * 20).toFixed(2) : '' });
      const ints = [t.subtotal, t.discount, t.taxable, t.tax, t.total].concat(t.lines.map((l) => l.net)).every(Number.isInteger);
      const sumLines = t.lines.reduce((a, l) => a + l.net, 0) === t.subtotal;
      const sumTax = t.taxes.reduce((a, x) => a + x.amount, 0) === t.tax;
      const total = t.total === t.subtotal - t.discount + t.tax && t.taxable === t.subtotal - t.discount;
      if (!(ints && sumLines && sumTax && total)) bad++;
    }
    out.propertyBad = bad;
    const pick = (t) => ({ sub: t.subtotal, disc: t.discount, taxable: t.taxable, tax: t.tax, total: t.total, due: t.due, taxes: t.taxes.map((x) => [x.label, x.rate, x.base, x.amount]) });
    Object.keys(out).forEach((k) => { if (out[k] && out[k].lines) out[k] = pick(out[k]); });
    return out;
  });
  h.assert.equal(r.pointThree.total, 30, '0.1 + 0.2 = 0.30 exactly');
  h.assert.equal(r.many.total, 3000, '1,000 lines of 3 × 0.01 = 30.00');
  h.assert.equal(r.third.total, 100, '0.333 × 3.00 rounds to 1.00');
  h.assert.equal(r.half.total, 13, '0.125 rounds half away from zero to 0.13');
  h.assert.equal(r.neg.total, -13, '-0.125 rounds to -0.13');
  h.assert.equal(r.lineDisc.sub, 3000 + 850, 'line discounts: 33.33 \u2212 3.33 + 10.00 \u2212 1.50 = 38.50: ' + JSON.stringify(r.lineDisc));
  h.assert.equal(JSON.stringify(r.split.taxes), JSON.stringify([['CGST', 900, 5, 0], ['SGST', 900, 5, 0]]), 'CGST and SGST are each rounded: 9% of 0.05 is 0.00');
  h.assert.equal(r.igst.tax, 1, 'IGST 18% of 0.05 rounds to 0.01');
  h.assert.equal(JSON.stringify(r.splitBig.taxes.map((x) => x[3])), '[11111,11111]', '9% of 1234.57 = 111.11 each');
  h.assert.equal(r.splitBig.total, 123457 + 22222, 'split total');
  h.assert.equal(r.rates.disc, 1001, 'document discount 10.01');
  h.assert.equal(r.rates.taxable, 60003 - 1001, 'discount shared across rates exactly');
  h.assert.equal(r.rates.taxes.reduce((a, x) => a + x[2], 0), 60003 - 1001, 'per-rate bases add up to the taxable amount');
  h.assert.equal(r.incl.tax, 1800, 'inclusive: 118.00 holds 18.00 tax');
  h.assert.equal(r.incl.taxable, 10000, 'inclusive: net 100.00');
  h.assert.equal(r.incl.total, 11800, 'inclusive: total stays 118.00');
  h.assert.equal(r.paid.total, 10000, 'a unit price typed with too many decimals (49.995) is rounded to the cent first: 2 × 50.00');
  h.assert.equal(r.paid.due, 10000 - 5000, 'balance due after 50.00 paid');
  h.assert(r.eu === 123456 && r.en === 123456, 'both number styles parse: ' + r.eu + ' ' + r.en);
  h.assert(r.bad >= 2, 'unreadable amounts are reported, not guessed');
  h.assert.equal(JSON.stringify(r.huge), '["too large"]', 'an amount beyond the safe range is reported');
  h.assert.equal(JSON.stringify(r.fmt), JSON.stringify(['\u2212$0.13', '₹12,34,567.89', '1.234,56\u00A0€', 'JPY1,234']), 'formatting: ' + JSON.stringify(r.fmt));
  h.assert.equal(r.propertyBad, 0, '400 random documents always add up in whole cents');
};

/* ---------------- D17: numbering, store, erase ---------------- */

cases['D17: numbers count up per type with the person\'s pattern, survive a reload, and never repeat'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const a = await page.evaluate(() => {
    const S = LE.pdfDocs.store;
    S.eraseAll();
    const out = { first: S.peekNumber('invoice', '2026-11-12'), quote: S.peekNumber('quote', '2026-11-12') };
    S.useNumber('invoice', S.peekNumber('invoice'));
    out.second = S.peekNumber('invoice', '2026-11-12');
    S.pattern('invoice', 'MJ/{YY}{MM}/{###}');
    out.custom = S.peekNumber('invoice', '2026-03-05');
    S.useNumber('invoice', 'MJ/2603/050');
    out.afterHand = S.peekNumber('invoice', '2026-03-05');
    out.quoteStill = S.peekNumber('quote', '2026-11-12');
    return out;
  });
  h.assert.equal(a.first, 'INV-2026-0001', 'first invoice number');
  h.assert.equal(a.quote, 'QUO-2026-0001', 'quotes count on their own');
  h.assert.equal(a.second, 'INV-2026-0002', 'next after use');
  h.assert.equal(a.custom, 'MJ/2603/002', 'own pattern');
  h.assert.equal(a.afterHand, 'MJ/2603/051', 'a hand-typed higher number moves the counter on');
  h.assert.equal(a.quoteStill, 'QUO-2026-0001', 'other types untouched');
  await page.reload();
  await page.waitForFunction(() => window.LE && LE.pdfDocs);
  const b = await page.evaluate(() => LE.pdfDocs.store.peekNumber('invoice', '2026-03-05'));
  h.assert.equal(b, 'MJ/2603/051', 'counter and pattern persist on this device');
};

cases['D17: the client list is kept on this device, exports and imports safely, and erases completely'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(() => {
    const S = LE.pdfDocs.store;
    S.eraseAll();
    S.saveClient({ name: 'Northwind Traders', email: 'ap@northwind.example', address: '221 MG Road' });
    S.saveClient({ name: 'Acme Ltd', email: 'billing@acme.example', evil: '<script>', __proto__: { polluted: 1 } });
    const exported = S.exportClients();
    S.eraseClients();
    const afterErase = S.clients().length;
    const imp = S.importClients(exported);
    const hostile = S.importClients(JSON.stringify({ clients: [{ name: '' }, { name: 'X'.repeat(5000), __proto__: { admin: true } }, 'nope', { name: 'Acme Ltd', email: 'billing@acme.example', phone: '123' }, { constructor: { prototype: { p: 1 } }, name: 'Proto Co' }] }));
    let badFile = '';
    try { S.importClients('not json'); } catch (e) { badFile = e.message; }
    return { exported: JSON.parse(exported).clients.map((c) => c.name), afterErase, imp, hostile, badFile, names: S.clients().map((c) => c.name.slice(0, 20)), keys: Object.keys(S.clients()[0]), polluted: ({}).polluted || ({}).admin || null, raw: localStorage.getItem('le-docs-v1').length };
  });
  h.assert.equal(JSON.stringify(r.exported), JSON.stringify(['Acme Ltd', 'Northwind Traders']), 'export lists saved clients');
  h.assert.equal(r.afterErase, 0, 'erase clients empties the list');
  h.assert.equal(r.imp.added, 2, 'import brings them back');
  h.assert(r.hostile.skipped === 2 && r.hostile.updated === 1 && r.hostile.added === 2, 'hostile import: empty and non-object rows skipped, duplicate updated: ' + JSON.stringify(r.hostile));
  h.assert(/not a client list/.test(r.badFile), 'a broken file is refused: ' + r.badFile);
  h.assert(r.keys.every((k) => ['id', 'name', 'contact', 'address', 'email', 'phone', 'taxId', 'notes'].indexOf(k) >= 0), 'only known fields are stored: ' + r.keys);
  h.assert.equal(r.polluted, null, 'no prototype pollution');
  await page.reload();
  await page.waitForFunction(() => window.LE && LE.pdfDocs);
  const kept = await page.evaluate(() => LE.pdfDocs.store.clients().length);
  h.assert.equal(kept, 4, 'clients persist after a reload');
  const gone = await page.evaluate(() => { LE.pdfDocs.store.eraseAll(); return { stored: localStorage.getItem('le-docs-v1'), clients: LE.pdfDocs.store.clients().length }; });
  h.assert(gone.stored === null && gone.clients === 0, 'erase everything removes the stored data: ' + JSON.stringify(gone));
};

/* ---------------- D17: PDFs ---------------- */

cases['D17: every type and template makes a real-text PDF that contains every field'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const D = LE.pdfDocs;
    const c = document.createElement('canvas'); c.width = 120; c.height = 60; c.getContext('2d').fillRect(10, 10, 40, 40);
    const doc = {
      type: 'invoice', number: 'INV-2026-0042', issued: '2026-11-12', terms: '14', due: '2026-11-26', reference: 'PO 7781', paper: 'A4', logo: c.toDataURL('image/png'),
      business: { name: 'Meera Joshi Design Studio', address: '14 Lake Road\nPune 411001', email: 'hello@meera.studio', phone: '+91 98200 00000', website: 'meera.studio', regLabel: 'GSTIN', regValue: '27ABCDE1234F1Z5' },
      client: { name: 'Northwind Traders', contact: 'Attn: Accounts', address: '221 MG Road\nBengaluru 560001', email: 'ap@northwind.example', taxId: '29AAACN1234Q1Z2' },
      items: [{ description: 'Brand identity work', qty: '1', price: '45000' }, { description: 'Business cards', qty: '2', price: '3500', discount: '10%' }, { description: 'Revisions (hours)', qty: '2.5', price: '1800' }],
      currency: { code: 'INR', symbol: '₹', place: 'before', decimals: 2, style: 'in' }, tax: { mode: 'doc', preset: 'gst-split', rate: '18' }, discount: '5%', paid: '10000',
      notes: 'Thank you LENOTES', payment: 'Bank: Example Bank LEPAY', qr: 'upi://pay?pa=meera@exmp&am=1', qrLabel: 'Scan to pay LEQR'
    };
    const out = {};
    const combos = D.TEMPLATES.map((t) => [t.id, 'invoice']).concat(Object.keys(D.TYPES).filter((x) => x !== 'invoice').map((x) => ['classic', x]));
    for (const [tpl, type] of combos) {
      {
        const res = await D.render(Object.assign({}, doc, { type, template: tpl }));
        const read = await window.__read(res.bytes);
        out[tpl + '/' + type] = { text: read.text.join(' '), images: read.images, pages: read.pages, title: read.title, size: res.bytes.length, total: res.totals.total };
      }
    }
    out.letter = (await window.__read((await D.render(Object.assign({}, doc, { paper: 'Letter' }))).bytes)).pages;
    return out;
  });
  const fields = ['Meera Joshi Design Studio', '14 Lake Road', 'Pune 411001', 'hello@meera.studio', '+91 98200 00000', 'meera.studio', 'GSTIN: 27ABCDE1234F1Z5', 'INV-2026-0042',
    'Northwind Traders', 'Attn: Accounts', '221 MG Road', 'Bengaluru 560001', 'ap@northwind.example', '29AAACN1234Q1Z2', 'PO 7781', 'INR',
    'Brand identity work', '₹45,000.00', 'Business cards', '\u2212₹700.00', '₹6,300.00', 'Revisions (hours)', '2.5', '₹4,500.00',
    'Subtotal', '₹55,800.00', 'Discount (5%)', '\u2212₹2,790.00', 'CGST 9%', '₹4,770.90', 'SGST 9%', 'Total (INR)', '₹62,551.80', 'LENOTES', 'LEPAY', 'LEQR'];
  Object.keys(r).filter((k) => k !== 'letter').forEach((k) => {
    const t = flat(r[k].text);
    const type = k.split('/')[1];
    fields.forEach((f) => { const want = type === 'credit' && f === 'Total (INR)' ? 'Total credit (INR)' : f; h.assert(t.indexOf(want) >= 0, k + ': "' + want + '" is in the PDF text'); });
    h.assert(t.indexOf({ invoice: 'INVOICE', quote: 'QUOTE', estimate: 'ESTIMATE', receipt: 'RECEIPT', credit: 'CREDIT NOTE' }[type]) >= 0, k + ' title');
    h.assert.equal(r[k].pages, 1, k + ' is one page');
    h.assert(r[k].images >= 2, k + ': logo and QR code are images: ' + r[k].images);
    h.assert(r[k].size < 120000, k + ' size ' + r[k].size);
    h.assert(/INV-2026-0042/.test(r[k].title), k + ' title metadata: ' + r[k].title);
  });
  h.assert(flat(r['classic/invoice'].text).indexOf('Balance due ₹52,551.80') >= 0, 'balance due after payment');
  h.assert(flat(r['classic/receipt'].text).indexOf('Amount received') >= 0, 'receipt shows the amount received');
  h.assert(flat(r['classic/quote'].text).indexOf('Valid until') >= 0, 'quote shows valid until');
  h.assert.noErrors(page);
};

cases['D17: in the studio a person makes, downloads, numbers, saves, duplicates and erases an invoice'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(() => LE.pdfDocs.store.eraseAll());
  await page.click('#ps-rail [data-panel="docs"]');
  await page.click('[data-new="invoice"]');
  const fill = async (k, v, n) => page.locator('[data-k="' + k + '"]').nth(n || 0).fill(v);
  await fill('business.name', 'LEBIZ Studio');
  await fill('client.name', 'LECLIENT Traders');
  await fill('item.description', 'LEITEM design');
  await fill('item.price', '0.10');
  await page.click('[data-act="add-line"]');
  await fill('item.description', 'LEITEM two', 1);
  await fill('item.price', '0.20', 1);
  await fill('currency.code', 'EUR');
  await fill('currency.symbol', '€');
  await page.waitForFunction(() => /0\.30/.test(document.querySelector('.pd-totals').textContent));
  h.assert(/Total\s*€0\.30/.test(await page.textContent('.pd-totals')), 'live totals: ' + await page.textContent('.pd-totals'));
  await page.click('[data-act="save-client"]');
  const r = await h.capture(page, () => page.click('[data-act="download"]'), 30000);
  h.assert(/^Invoice-INV-\d{4}-0001-LECLIENT-Traders\.pdf$/.test(r.name), 'file name: ' + r.name);
  const info = await h.pdfRead(browser, base, r.buf);
  ['LEBIZ Studio', 'LECLIENT Traders', 'LEITEM design', 'LEITEM two', '€0.30', 'INVOICE'].forEach((t) => h.assert(flat(info.text).indexOf(t) >= 0, 'downloaded PDF has "' + t + '"'));
  await page.click('[data-act="duplicate"]');
  h.assert(/INV-\d{4}-0002/.test(await page.textContent('#pd-work-title')), 'duplicate takes the next number: ' + await page.textContent('#pd-work-title'));
  await page.click('.pd-close');
  const panel = await page.textContent('.ps-pane[data-pane="docs"]');
  h.assert(/INV-\d{4}-0001/.test(panel) && /INV-\d{4}-0002/.test(panel), 'both are saved on this device: ' + panel.slice(0, 200));
  h.assert(/1 saved on this device/.test(panel), 'the client was saved');
  await page.click('[data-job="clients"]');
  await page.click('[data-act="erase-all"]');
  await page.click('.pd-close');
  const after = await page.evaluate(() => ({ drafts: LE.pdfDocs.store.drafts().length, clients: LE.pdfDocs.store.clients().length, raw: localStorage.getItem('le-docs-v1') }));
  h.assert(after.drafts === 0 && after.clients === 0, 'erase everything: ' + JSON.stringify(after));
  h.assert.noErrors(page);
  h.assert.equal(page.foreign.length, 0, 'no outside requests');
};

cases['D17: the invoice editor works on a 390 px and a 360 px phone'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studio(h, browser, base, vp);
    await page.evaluate(() => { PS.openPanel('docs'); });
    await page.click('[data-new="quote"]');
    await page.locator('[data-k="item.price"]').first().fill('12.50');
    await page.waitForSelector('.pd-stage canvas');
    h.assert(await h.noOverflow(page), vp + ': no sideways scroll');
    const small = await page.evaluate(() => [...document.querySelectorAll('.pd-work button:not([hidden])')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40 && !b.closest('.pd-grid')).map((b) => (b.getAttribute('aria-label') || b.textContent).trim() + ' ' + Math.round(b.getBoundingClientRect().height)));
    h.assert(!small.length, vp + ': touch targets are at least 40 px: ' + small.join(', '));
    h.assert.noErrors(page);
    await page.context().close();
  }
};

module.exports = cases;
