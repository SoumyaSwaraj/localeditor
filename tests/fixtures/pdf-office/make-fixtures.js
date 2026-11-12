/* Builds the small fixtures for tests/pdf-office.test.js with the vendored pdf-lib, inside Chromium.
   Usage: node tests/fixtures/pdf-office/make-fixtures.js
   The contract pair has exactly six planted changes, listed in CONTRACT_CHANGES (tests read this file's export). */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

/* Paragraphs of version 1. Version 2 applies the six changes below. */
const P1 = [
  'This Services Agreement is made between Northwind Traders Limited and Contoso Facilities Group for cleaning and maintenance of the offices at 12 Harbour Street.',
  'The Supplier will provide the services described in Schedule 1 from the start date of 1 March 2026 and will keep the premises in good order at all times.',
  'The Client will pay the Supplier a fixed fee of $10,000 per quarter, invoiced in arrears, with payment due within thirty days of the invoice date.',
  'Either party may end this agreement by giving the other party three months of written notice, sent by recorded delivery to the address above.',
  'The Supplier keeps public liability insurance with a limit of not less than five million pounds and will show the certificate when asked.',
  'Confidential information shared under this agreement must not be disclosed to anyone else without the written consent of the other party.',
  'Any dispute will first be discussed in good faith by senior managers of both parties before either party starts formal proceedings.',
  'The Supplier will carry out a deep clean of all kitchens once every month and will record the work in the shared maintenance log.',
  'This agreement is governed by the law of England and Wales and the courts of England have exclusive jurisdiction over any claim.',
  'Signed for and on behalf of both parties on the dates written below.'
];
const MOVED = 'The Supplier keeps public liability insurance with a limit of not less than five million pounds and will show the certificate when asked.';
const ADDED = 'All staff sent to the premises will carry photo identification issued by the Supplier.';
const REMOVED_SENTENCE = 'The Supplier will carry out a deep clean of all kitchens once every month and will record the work in the shared maintenance log.';
function version2() {
  const p = P1.slice();
  p[1] = p[1].replace('1 March 2026', '15 March 2026');
  p[2] = p[2].replace('$10,000', '$12,500').replace('thirty days', 'sixty days');
  p.splice(p.indexOf(MOVED), 1);
  p.splice(p.indexOf(REMOVED_SENTENCE), 1);
  p.splice(1, 0, MOVED);
  const conf = p.findIndex((x) => x.indexOf('Confidential information') === 0);
  p.splice(conf + 1, 0, ADDED);
  return p;
}
const CONTRACT_CHANGES = {
  amount: ['$10,000', '$12,500'],
  date: ['1', '15'],
  word: ['thirty', 'sixty'],
  moved: MOVED,
  added: ADDED,
  removed: REMOVED_SENTENCE,
  count: 6
};

async function build() {
  const h = require('../../lib/harness');
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const page = await h.open(browser, base, '/pdf-studio/');
  const out = await page.evaluate(async ({ P1, P2 }) => {
    await LE.pdf.ready();
    const L = window.PDFLib;
    const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFNumber, PDFHexString } = L;
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const files = {};
    const fixed = new Date('2026-11-01T09:00:00Z');
    const stamp = (doc, title) => { doc.setTitle(title); doc.setProducer('LocalEditor fixtures'); doc.setCreator('LocalEditor fixtures'); doc.setCreationDate(fixed); doc.setModificationDate(fixed); };

    /* 1. A form with typical field names, a tooltip-only field, a label-only field, a password and a signature-like field */
    {
      const doc = await PDFDocument.create();
      const p = doc.addPage([595.28, 841.89]);
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const fb = await doc.embedFont(StandardFonts.HelveticaBold);
      p.drawText('Membership application', { x: 56, y: 780, size: 20, font: fb });
      const form = doc.getForm();
      let y = 730;
      const rows = [
        ['First Name', 'First name'], ['Surname', 'Surname'], ['f1_03', '', 'Middle name'],
        ['Email Address', 'Email'], ['Phone', 'Phone'], ['Mobile', 'Mobile'],
        ['DOB', 'Date of birth (DD/MM/YYYY)', 'Date of birth DD/MM/YYYY'],
        ['Address Line 1', 'Address'], ['Address Line 2', ''], ['Text7', 'Town / City:'], ['Postcode', 'Postcode'],
        ['Company', 'Company'], ['VAT Number', 'VAT number'], ['IBAN', 'IBAN'], ['Notes', 'Anything else?'],
        ['Account Password', 'Choose a password'], ['Signature of applicant', 'Signature'], ['Date', 'Date']
      ];
      for (const [name, label, tip] of rows) {
        if (label) p.drawText(label, { x: 56, y: y + 7, size: 10, font: f });
        const tf = form.createTextField(name);
        tf.addToPage(p, { x: 230, y, width: 300, height: 20, font: f });
        if (tip) tf.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(tip));
        if (name === 'Account Password') tf.enablePassword();
        y -= 32;
      }
      p.drawText('Country', { x: 56, y: y + 7, size: 10, font: f });
      const dd = form.createDropdown('Country');
      dd.addOptions(['Germany', 'India', 'United Kingdom']);
      dd.addToPage(p, { x: 230, y, width: 200, height: 20, font: f });
      stamp(doc, 'Membership application');
      files['form.pdf'] = b64(await doc.save());
    }

    /* 2. Two versions of a contract (three pages each) */
    async function contract(paras, title) {
      const doc = await PDFDocument.create();
      const f = await doc.embedFont(StandardFonts.TimesRoman);
      const fb = await doc.embedFont(StandardFonts.TimesRomanBold);
      const W = 595.28, H = 841.89, M = 72, size = 12, lead = 17;
      let p = doc.addPage([W, H]), y = H - M;
      p.drawText(title, { x: M, y, size: 18, font: fb });
      y -= 36;
      for (let i = 0; i < paras.length; i++) {
        const words = paras[i].split(' ');
        const lines = [];
        let line = '';
        for (const w of words) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > W - 2 * M) { lines.push(line); line = w; } else line = t; }
        lines.push(line);
        if (y - lines.length * lead < M) { p = doc.addPage([W, H]); y = H - M; }
        for (const l of lines) { p.drawText(l, { x: M, y, size, font: f }); y -= lead; }
        y -= 14;
        if (i === 3 || i === 6) { p = doc.addPage([W, H]); y = H - M; }
      }
      stamp(doc, title);
      return b64(await doc.save());
    }
    files['contract-v1.pdf'] = await contract(P1, 'Services Agreement');
    files['contract-v2.pdf'] = await contract(P2, 'Services Agreement');

    /* 3. Three small documents for a bundle (the first has its own bookmarks), and a logo */
    async function small(title, pages, outline) {
      const doc = await PDFDocument.create();
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const refs = [];
      for (let i = 0; i < pages; i++) {
        const p = doc.addPage([595.28, 841.89]);
        p.drawText(title + ' — page ' + (i + 1), { x: 72, y: 760, size: 16, font: f });
        p.drawText('Body text for ' + title.toLowerCase() + '.', { x: 72, y: 730, size: 11, font: f });
        refs.push(p.ref);
      }
      if (outline) {
        const ctx = doc.context, root = ctx.nextRef(), items = refs.map(() => ctx.nextRef());
        refs.forEach((r, i) => {
          const dict = ctx.obj({ Title: PDFHexString.fromText('Chapter ' + (i + 1)), Parent: root, Dest: [r, 'Fit'] });
          if (i) dict.set(PDFName.of('Prev'), items[i - 1]);
          if (i < refs.length - 1) dict.set(PDFName.of('Next'), items[i + 1]);
          ctx.assign(items[i], dict);
        });
        ctx.assign(root, ctx.obj({ Type: 'Outlines', First: items[0], Last: items[items.length - 1], Count: PDFNumber.of(items.length) }));
        doc.catalog.set(PDFName.of('Outlines'), root);
      }
      stamp(doc, title);
      return b64(await doc.save());
    }
    files['bundle-letter.pdf'] = await small('Engagement letter', 2, true);
    files['bundle-terms.pdf'] = await small('Terms of business', 1, false);
    files['bundle-invoice.pdf'] = await small('Invoice 2026-114', 3, false);
    {
      const c = document.createElement('canvas'); c.width = 240; c.height = 80;
      const g = c.getContext('2d');
      g.fillStyle = '#2B59C3'; g.fillRect(0, 0, 80, 80);
      g.fillStyle = '#16131C'; g.font = 'bold 34px sans-serif'; g.fillText('ACME', 92, 54);
      files['logo.png'] = await new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((ab) => r(b64(new Uint8Array(ab)))), 'image/png'));
    }

    /* 4. A commented file: a note with a reply, a highlight over known text, a strike-out and a text box */
    {
      const doc = await PDFDocument.create();
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const p1 = doc.addPage([595.28, 841.89]);
      const p2 = doc.addPage([595.28, 841.89]);
      p1.drawText('Quarterly report', { x: 72, y: 760, size: 18, font: f });
      p1.drawText('Revenue grew with net payment terms unchanged.', { x: 72, y: 720, size: 12, font: f });
      p2.drawText('Costs fell in the third quarter.', { x: 72, y: 760, size: 12, font: f });
      const ctx = doc.context;
      const w1 = f.widthOfTextAtSize('Revenue grew with ', 12), w2 = f.widthOfTextAtSize('net payment terms', 12);
      const qx0 = 72 + w1, qx1 = qx0 + w2;
      const date = PDFString.of('D:20261105101500Z');
      const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: PDFHexString.fromText('Please check this figure'), T: PDFHexString.fromText('Asha Rao'), M: date, NM: PDFString.of('note-1'), Name: 'Comment' }));
      const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: PDFHexString.fromText('Fixed in version 2'), T: PDFHexString.fromText('Ben Ortiz'), M: PDFString.of('D:20261106090000Z'), IRT: note, RT: 'R', NM: PDFString.of('note-2') }));
      const hl = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [qx0, 716, qx1, 732], QuadPoints: [qx0, 732, qx1, 732, qx0, 716, qx1, 716], Contents: PDFHexString.fromText('Is 30 days right?'), T: PDFHexString.fromText('Asha Rao'), M: date, C: [1, 0.9, 0.2] }));
      const st = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'StrikeOut', Rect: [72, 756, 140, 772], QuadPoints: [72, 772, 100, 772, 72, 756, 100, 756], Contents: PDFHexString.fromText('Delete this word'), T: PDFHexString.fromText('Ben Ortiz'), M: date, C: [0.9, 0.1, 0.1] }));
      const ft = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [300, 600, 500, 640], Contents: PDFHexString.fromText('Approved by legal'), T: PDFHexString.fromText('Legal team'), M: date, DA: PDFString.of('/Helv 11 Tf 0 g') }));
      p1.node.set(PDFName.of('Annots'), ctx.obj([note, reply, hl]));
      p2.node.set(PDFName.of('Annots'), ctx.obj([st, ft]));
      stamp(doc, 'Quarterly report');
      files['commented.pdf'] = b64(await doc.save());
    }

    /* 5. Two scanned (image-only) versions of one page; the second has an extra mark */
    async function scan(extra) {
      const c = document.createElement('canvas'); c.width = 500; c.height = 700;
      const g = c.getContext('2d');
      g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 500, 700);
      g.fillStyle = '#333'; for (let y = 60; y < 600; y += 22) g.fillRect(40, y, 340 + (y % 70), 6);
      if (extra) { g.fillStyle = '#c00'; g.fillRect(300, 620, 150, 40); }
      const jpg = await new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((ab) => r(new Uint8Array(ab))), 'image/jpeg', 0.7));
      const doc = await PDFDocument.create();
      const img = await doc.embedJpg(jpg);
      const p = doc.addPage([500, 700]);
      p.drawImage(img, { x: 0, y: 0, width: 500, height: 700 });
      stamp(doc, 'Scan');
      return b64(await doc.save());
    }
    files['scan-v1.pdf'] = await scan(false);
    files['scan-v2.pdf'] = await scan(true);
    return files;
  }, { P1, P2: version2() });
  for (const [name, data] of Object.entries(out)) {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log(name.padEnd(22), Buffer.from(data, 'base64').length, 'bytes');
  }
  if (page.errors.length) console.log('console errors:', page.errors);
  await browser.close();
  server.close();
}

module.exports = { CONTRACT_CHANGES, P1, version2 };
if (require.main === module) build();
