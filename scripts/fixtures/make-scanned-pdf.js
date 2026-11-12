/* Builds scripts/fixtures/scanned.pdf: a small "scanned" PDF for the Make searchable tests (tests/pdf-ocr.test.js) and manual checks.
 *   node scripts/fixtures/make-scanned-pdf.js
 * Page 1: a scan (picture only) of an invoice with an email address, a phone number and a valid IBAN.
 * Page 2: a scan tilted by 1.5 degrees with shading and noise, saved as a lower-quality JPEG.
 * Page 3: an ordinary text page (real PDF text), which "Only pages without text" must leave alone.
 * Rendered by Chromium (Playwright) with the site's own pdf-lib; 150 dpi greyscale JPEG pages, A4. */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'scanned.pdf');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>fixture</title>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'assets/vendor/pdf-lib.min.js'), 'utf8') });
  const b64 = await page.evaluate(async () => {
    const W = 1240, H = 1754;                                   /* A4 at 150 dpi */
    function sheet(lines, opts) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#f7f5ef'; x.fillRect(0, 0, W, H);
      if (opts.shade) { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,50,30,0.22)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
      x.save(); x.translate(W / 2, H / 2); x.rotate((opts.tilt || 0) * Math.PI / 180); x.translate(-W / 2, -H / 2);
      x.fillStyle = '#1a1a1a';
      let y = 170;
      lines.forEach((l) => { x.font = (l.b ? '700 ' : '400 ') + (l.s || 30) + 'px "Liberation Serif", "Times New Roman", serif'; x.fillText(l.t, 130, y); y += (l.s || 30) * 1.75; });
      x.restore();
      if (opts.noise) {
        const im = x.getImageData(0, 0, W, H), d = im.data; let seed = 7;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * opts.noise; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
        x.putImageData(im, 0, 0);
      }
      return new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((a) => r(new Uint8Array(a))), 'image/jpeg', opts.q || 0.8));
    }
    const p1 = await sheet([
      { t: 'Quarterly invoice summary', s: 46, b: true },
      { t: 'Invoice 4471 was paid in full on 12 March.' },
      { t: 'Total due 1,250.00 EUR including tax.' },
      { t: 'Contact: anna.berg@example.com' },
      { t: 'Phone: +44 20 7946 0958' },
      { t: 'Account GB29 NWBK 6016 1331 9268 19' },
      { t: 'Thank you for your business with Northwind Traders.' }
    ], { noise: 10, q: 0.82 });
    const p2 = await sheet([
      { t: 'Delivery note', s: 46, b: true },
      { t: 'Twelve boxes of printer paper were delivered.' },
      { t: 'The warehouse in Leeds signed for the parcel.' },
      { t: 'Reference number 88213 for any questions.' },
      { t: 'Please keep this note with the invoice.' }
    ], { tilt: 1.5, shade: true, noise: 18, q: 0.6 });
    const L = PDFLib, doc = await L.PDFDocument.create();
    for (const jpg of [p1, p2]) {
      const img = await doc.embedJpg(jpg), pg = doc.addPage([595.28, 841.89]);
      pg.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    const p3 = doc.addPage([595.28, 841.89]), font = await doc.embedFont(L.StandardFonts.Helvetica);
    ['Notes typed on a computer', 'This page already has real text, so it is not read again.', 'It mentions the budget review in April.'].forEach((t, i) => p3.drawText(t, { x: 60, y: 760 - i * 28, size: i ? 13 : 20, font }));
    doc.setTitle('Scanned fixture'); doc.setCreator('LocalEditor tests'); doc.setProducer('LocalEditor tests');
    const bytes = await doc.save({ useObjectStreams: false });
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  });
  fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + fs.statSync(OUT).size + ' bytes)');
  await browser.close();
})();
