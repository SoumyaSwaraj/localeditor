/* Builds the table-extraction fixtures for tests/pdf-docs.test.js (D18) with the vendored pdf-lib, inside Chromium.
   Every PDF has a planted table; expected.json holds its cells exactly as they were drawn.
   Usage: node tests/fixtures/pdf-docs/make-fixtures.js   (the Word/Markdown/Excel fixtures come from make-fixtures.py) */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('../../lib/harness');

const OUT = __dirname;

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const page = await h.open(browser, base, '/pdf-studio/');
  const out = await page.evaluate(async () => {
    await LE.pdf.ready();
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const files = {}, expected = {};
    async function fonts(doc) { return { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) }; }
    /* draws rows at fixed column x positions; align: 'l' | 'r'; returns next y */
    function drawTable(p, f, x, y, cols, rows, o) {
      o = o || {};
      const rh = o.rowH || 18, size = o.size || 9.5;
      rows.forEach((row, ri) => {
        const lines = row.map((v) => String(v).split('\n'));
        const n = Math.max.apply(null, lines.map((l) => l.length));
        const hgt = rh + (n - 1) * (size * 1.25);
        if (o.grid) cols.forEach((c) => p.drawRectangle({ x: c.x - 4, y: y - hgt + 5, width: c.w, height: hgt, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 }));
        lines.forEach((cell, ci) => {
          const c = cols[ci];
          const font = ri === 0 && o.head ? f.b : f.r;
          cell.forEach((ln, li) => {
            const w = font.widthOfTextAtSize(ln, size);
            const tx = c.a === 'r' ? c.x + c.w - 10 - w : c.x;
            p.drawText(ln, { x: tx, y: y - li * size * 1.25 - 8, size, font });
          });
        });
        y -= hgt;
      });
      return y;
    }
    function para(p, f, x, y, text, size) { p.drawText(text, { x, y, size: size || 10, font: f.r }); }

    /* 1. a simple ruled grid between two paragraphs */
    {
      const doc = await PDFDocument.create(); const f = await fonts(doc); const p = doc.addPage([595, 842]);
      p.drawText('Quarterly supplier summary', { x: 56, y: 780, size: 16, font: f.b });
      para(p, f, 56, 752, 'The table below lists each supplier with orders and spend for the quarter. Figures are in euros.');
      const rows = [['Supplier', 'Country', 'Orders', 'Spend', 'Rating']];
      const names = ['Acme Parts', 'Borealis Ltd', 'Cobalt & Sons', 'Delta Office', 'Evergreen Paper', 'Fjord Tools', 'Granite Works', 'Harbor Freight', 'Iris Labs', 'Juniper Print', 'Kestrel Ink'];
      names.forEach((n, i) => rows.push([n, ['Germany', 'Norway', 'Ireland', 'Spain', 'France'][i % 5], String(3 + i * 4), (1250.5 + i * 317.25).toFixed(2), ['A', 'B', 'A', 'C'][i % 4]]));
      const cols = [{ x: 60, w: 150 }, { x: 210, w: 100 }, { x: 310, w: 70, a: 'r' }, { x: 380, w: 90, a: 'r' }, { x: 470, w: 70 }];
      const end = drawTable(p, f, 60, 730, cols, rows, { grid: true, head: true });
      para(p, f, 56, end - 30, 'Ratings are reviewed every six months by the purchasing team.');
      files['tables-grid.pdf'] = b64(await doc.save()); expected['tables-grid.pdf'] = [{ page: 0, header: true, rows }];
    }
    /* 2. borderless columns, numbers right-aligned, a leading-zero ID column and dates */
    {
      const doc = await PDFDocument.create(); const f = await fonts(doc); const p = doc.addPage([595, 842]);
      p.drawText('Stock count', { x: 56, y: 780, size: 16, font: f.b });
      const rows = [['Item ID', 'Description', 'Counted', 'Unit cost', 'Last count']];
      for (let i = 0; i < 14; i++) rows.push(['00' + (4100 + i * 7), ['Copy paper A4', 'Toner black', 'Stapler', 'Envelopes C5', 'Folders blue', 'Pens (box)', 'Notebooks'][i % 7], String(i * 13 % 90 + 1), (2.5 + i * 1.1).toFixed(2), '2026-0' + (i % 9 + 1) + '-1' + (i % 9)]);
      const cols = [{ x: 60, w: 80 }, { x: 150, w: 170 }, { x: 320, w: 70, a: 'r' }, { x: 390, w: 80, a: 'r' }, { x: 480, w: 80 }];
      drawTable(p, f, 60, 740, cols, rows, { head: true, rowH: 16 });
      files['tables-borderless.pdf'] = b64(await doc.save()); expected['tables-borderless.pdf'] = [{ page: 0, header: true, rows }];
    }
    /* 3. wrapped description cells */
    {
      const doc = await PDFDocument.create(); const f = await fonts(doc); const p = doc.addPage([595, 842]);
      p.drawText('Change log', { x: 56, y: 780, size: 16, font: f.b });
      const drawn = [['Ref', 'Change', 'Owner', 'Hours'],
        ['CH-1', 'Move the front desk forms\nto the shared drive', 'Priya', '6'],
        ['CH-2', 'Replace the old printer', 'Daniel', '2'],
        ['CH-3', 'Train staff on the new\npassword manager and\nbackup routine', 'Zoe', '12'],
        ['CH-4', 'Archive 2019 invoices', 'Tomas', '4'],
        ['CH-5', 'Label every cable in the\nserver cupboard', 'Aiko', '3']];
      const cols = [{ x: 60, w: 70 }, { x: 140, w: 220 }, { x: 370, w: 90 }, { x: 460, w: 60, a: 'r' }];
      drawTable(p, f, 60, 740, cols, drawn, { head: true, rowH: 20, grid: false });
      const rows = drawn.map((r) => r.map((c) => c.replace(/\n/g, ' ')));
      files['tables-wrapped.pdf'] = b64(await doc.save()); expected['tables-wrapped.pdf'] = [{ page: 0, header: true, rows }];
    }
    /* 4. one table over three pages with the header repeated */
    {
      const doc = await PDFDocument.create(); const f = await fonts(doc);
      const head = ['Date', 'Employee', 'Project', 'Hours', 'Rate'];
      const body = [];
      for (let i = 0; i < 100; i++) body.push(['2026-11-' + String(i % 28 + 1).padStart(2, '0'), ['Priya Sharma', 'Daniel Okafor', 'Sofia Rossi', 'Kwame Mensah'][i % 4], 'P-' + (200 + i % 6), String((i % 8) + 0.5), String(40 + i % 5 * 5)]);
      const cols = [{ x: 60, w: 90 }, { x: 150, w: 140 }, { x: 290, w: 80 }, { x: 370, w: 60, a: 'r' }, { x: 430, w: 60, a: 'r' }];
      let i = 0, pageNo = 0;
      while (i < body.length) {
        const p = doc.addPage([595, 842]);
        if (pageNo === 0) p.drawText('Timesheet, November', { x: 56, y: 790, size: 16, font: f.b });
        const n = Math.min(40, body.length - i);
        drawTable(p, f, 60, pageNo === 0 ? 760 : 790, cols, [head].concat(body.slice(i, i + n)), { head: true, rowH: 17 });
        p.drawText('Page ' + (pageNo + 1), { x: 280, y: 30, size: 8, font: f.r });
        i += n; pageNo++;
      }
      files['tables-multipage.pdf'] = b64(await doc.save()); expected['tables-multipage.pdf'] = [{ page: 0, pages: [0, 1, 2], header: true, rows: [head].concat(body) }];
    }
    /* 5. a "scanned" page: a picture only, no text */
    {
      const doc = await PDFDocument.create(); const p = doc.addPage([595, 842]);
      const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 200); x.fillStyle = '#000'; x.font = '20px sans-serif'; x.fillText('Name   Amount', 20, 40); x.fillText('Alpha  10', 20, 80);
      const png = await doc.embedPng(await (await fetch(c.toDataURL('image/png'))).arrayBuffer());
      p.drawImage(png, { x: 60, y: 500, width: 400, height: 200 });
      files['tables-scanned.pdf'] = b64(await doc.save()); expected['tables-scanned.pdf'] = [];
    }
    return { files, expected };
  });
  Object.keys(out.files).forEach((n) => fs.writeFileSync(path.join(OUT, n), Buffer.from(out.files[n], 'base64')));
  fs.writeFileSync(path.join(OUT, 'expected-tables.json'), JSON.stringify(out.expected, null, 1) + '\n');
  console.log('wrote', Object.keys(out.files).join(', '), 'and expected-tables.json');
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
