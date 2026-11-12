/* Builds the small fixtures for tests/pdf-bulk.test.js with the vendored pdf-lib and SheetJS, inside Chromium.
   Usage: node tests/fixtures/pdf-bulk/make-fixtures.js */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('../../lib/harness');

const OUT = __dirname;

const PEOPLE = [
  ['Priya Sharma', '10001', 'November 2026', '3,250.00', '1990-04-23', 2],
  ['Daniel Okafor', '10002', 'November 2026', '2,980.50', '1985-11-02', 3],
  ['Zoë Müller', '10003', 'November 2026', '4,105.75', '1992-07-14', 2],
  ['Łukasz Nowak', '10004', 'November 2026', '2,760.00', '1988-01-30', 2],
  ['Amelia Chen', '10005', 'November 2026', '3,512.20', '1979-09-09', 3],
  ['Rahul Verma', '10006', 'November 2026', '2,890.00', '1995-12-01', 2],
  ['Sofia Rossi', '10007', 'November 2026', '3,330.40', '1991-03-17', 3],
  ['Tomás García', '10008', 'November 2026', '2,640.10', '1987-06-25', 2],
  ['Hannah Schmidt', '10009', 'November 2026', '3,980.00', '1983-10-05', 3],
  ['Kwame Mensah', '10010', 'November 2026', '2,705.65', '1994-02-28', 2],
  ['Aiko Tanaka', '10011', 'November 2026', '3,145.00', '1990-08-08', 3],
  ['Liam O\'Brien', '10012', 'November 2026', '2,999.99', '1986-05-19', 3]
];

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const page = await h.open(browser, base, '/pdf-studio/');
  const out = await page.evaluate(async (PEOPLE) => {
    await LE.pdf.ready();
    await LE.lazy('../assets/vendor/xlsx.full.min.js');
    const L = window.PDFLib;
    const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFNumber, PDFArray, PDFNull } = L;
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const files = {};

    /* 1. AcroForm template */
    {
      const doc = await PDFDocument.create();
      const p = doc.addPage([595.28, 841.89]);
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const fb = await doc.embedFont(StandardFonts.HelveticaBold);
      p.drawText('ACME Ltd · Payslip', { x: 56, y: 770, size: 22, font: fb });
      const form = doc.getForm();
      [['name', 'Employee name', 700], ['employee_id', 'Employee ID', 650], ['month', 'Pay period', 600], ['net_pay', 'Net pay', 550]].forEach(([n, label, y]) => {
        p.drawText(label, { x: 56, y: y + 6, size: 11, font: f });
        const tf = form.createTextField(n);
        tf.addToPage(p, { x: 200, y, width: 300, height: 24, font: f });
      });
      p.drawText('Paid by bank transfer', { x: 56, y: 506, size: 11, font: f });
      form.createCheckBox('paid').addToPage(p, { x: 200, y: 500, width: 18, height: 18 });
      files['form-template.pdf'] = b64(await doc.save());
    }

    /* 2. {{placeholder}} template drawn as page text */
    {
      const doc = await PDFDocument.create();
      const p = doc.addPage([595.28, 841.89]);
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const fb = await doc.embedFont(StandardFonts.HelveticaBold);
      const ft = await doc.embedFont(StandardFonts.TimesRoman);
      p.drawRectangle({ x: 40, y: 740, width: 515, height: 60, color: rgb(0.93, 0.95, 1) });
      p.drawText('ACME Ltd · Payslip', { x: 56, y: 762, size: 22, font: fb, color: rgb(0.1, 0.12, 0.3) });
      p.drawText('Employee: {{name}}', { x: 56, y: 690, size: 13, font: f });
      p.drawText('Employee ID:', { x: 56, y: 665, size: 13, font: f });
      p.drawText('{{employee_id}}', { x: 160, y: 665, size: 13, font: fb });
      p.drawText('Pay period: {{month}}', { x: 56, y: 640, size: 13, font: f });
      p.drawText('Net pay', { x: 56, y: 600, size: 15, font: fb });
      p.drawText('{{net_pay}}', { x: 400, y: 600, size: 15, font: fb, color: rgb(0.05, 0.4, 0.2) });
      p.drawText('Dear {{name}}, thank you for your work in {{month}}.', { x: 56, y: 540, size: 12, font: ft });
      p.drawText('This payslip was prepared on this device and never uploaded.', { x: 56, y: 90, size: 9, font: f, color: rgb(0.4, 0.4, 0.4) });
      files['placeholder-template.pdf'] = b64(await doc.save());
    }

    /* 3. A 30-page payslip run with an ID on every page, bookmarks per person and one scanned (image-only) page */
    {
      const doc = await PDFDocument.create();
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const fb = await doc.embedFont(StandardFonts.HelveticaBold);
      doc.registerFontkit(window.fontkit);
      const fu = await doc.embedFont(new Uint8Array(await LE.fonts.bytes('Plus Jakarta Sans', 400, false)), { subset: true });
      const c = document.createElement('canvas');
      c.width = 400; c.height = 560;
      const g = c.getContext('2d');
      g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 400, 560);
      g.fillStyle = '#333'; for (let y = 40; y < 520; y += 18) g.fillRect(30, y, 300 + (y % 50), 5);
      const scan = await doc.embedJpg(await new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((ab) => r(new Uint8Array(ab))), 'image/jpeg', 0.6)));
      const firstPages = [];
      let pageNo = 0;
      for (const [name, id, month, net, dob, count] of PEOPLE) {
        for (let k = 0; k < count; k++) {
          const p = doc.addPage([595.28, 841.89]);
          pageNo++;
          if (k === 0) firstPages.push({ name, ref: p.ref });
          if (pageNo === 9) { p.drawImage(scan, { x: 50, y: 100, width: 495, height: 693 }); continue; }
          p.drawText('ACME Ltd · Payroll · ' + month, { x: 56, y: 790, size: 10, font: f, color: rgb(0.4, 0.4, 0.4) });
          p.drawText('Employee ID: ' + id, { x: 56, y: 760, size: 13, font: fb });
          p.drawText('Name:', { x: 56, y: 740, size: 12, font: f });
          p.drawText(name, { x: 110, y: 740, size: 12, font: fu });
          p.drawText(k === 0 ? 'Earnings and deductions' : 'Continued: tax and pension details', { x: 56, y: 700, size: 12, font: f });
          p.drawText('Page ' + (k + 1) + ' of ' + count, { x: 480, y: 40, size: 9, font: f });
        }
      }
      /* outline: one top-level bookmark per employee */
      const ctx = doc.context;
      const outlineRef = ctx.nextRef();
      const refs = firstPages.map(() => ctx.nextRef());
      firstPages.forEach((fp, i) => {
        const dict = ctx.obj({});
        dict.set(PDFName.of('Title'), L.PDFHexString.fromText(fp.name));
        dict.set(PDFName.of('Parent'), outlineRef);
        if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
        if (i < refs.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
        dict.set(PDFName.of('Dest'), ctx.obj([fp.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
        ctx.assign(refs[i], dict);
      });
      const outline = ctx.obj({});
      outline.set(PDFName.of('Type'), PDFName.of('Outlines'));
      outline.set(PDFName.of('First'), refs[0]);
      outline.set(PDFName.of('Last'), refs[refs.length - 1]);
      outline.set(PDFName.of('Count'), PDFNumber.of(refs.length));
      ctx.assign(outlineRef, outline);
      doc.catalog.set(PDFName.of('Outlines'), outlineRef);
      doc.setTitle('Payslips November 2026');
      files['payslips-30.pdf'] = b64(await doc.save());
    }

    /* 4. Image-heavy file: big JPEGs and a big RGB Flate image (recompressible), plus a grey Flate image,
       a CMYK image and an image with a soft mask (skipped by design), and selectable text on every page. */
    {
      const doc = await PDFDocument.create();
      const f = await doc.embedFont(StandardFonts.Helvetica);
      const photo = (w, h, seed, q) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 0, w, h);
        gr.addColorStop(0, ['#2f6db5', '#b5562f', '#3f9b55'][seed % 3]); gr.addColorStop(1, '#f2d594');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        let s = seed * 9301 + 49297;
        const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
        for (let i = 0; i < 900; i++) { g.fillStyle = 'hsla(' + Math.floor(rnd() * 360) + ',60%,' + Math.floor(30 + rnd() * 50) + '%,0.5)'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 4 + rnd() * 40, 0, 7); g.fill(); }
        const id = g.getImageData(0, 0, w, h);
        for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
        g.putImageData(id, 0, 0);
        return new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((ab) => r({ bytes: new Uint8Array(ab), canvas: c })), q ? 'image/jpeg' : 'image/png', q));
      };
      for (let i = 0; i < 3; i++) {
        const p = doc.addPage([595.28, 841.89]);
        const jpg = await photo(1000, 750, i + 1, 0.9);
        const im = await doc.embedJpg(jpg.bytes);
        p.drawImage(im, { x: 56, y: 400, width: 300, height: 225 });
        p.drawText('Site report page ' + (i + 1) + ': the photo above is printed small, so it carries far more pixels than it needs.', { x: 56, y: 370, size: 9, font: f });
        p.drawText('Inspection reference SR-' + (4410 + i), { x: 56, y: 350, size: 12, font: f });
      }
      const p4 = doc.addPage([595.28, 841.89]);
      p4.drawText('Raw images: RGB (recompressible), grey, CMYK and masked (left as they are).', { x: 40, y: 800, size: 10, font: f });
      const ctx = doc.context;
      const rawImage = (w, h, comps, cs, fill, extra) => {
        const data = new Uint8Array(w * h * comps);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < comps; k++) data[(y * w + x) * comps + k] = fill(x, y, k);
        const dict = Object.assign({ Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: 8, ColorSpace: cs }, extra || {});
        return ctx.register(ctx.flateStream(data, dict));
      };
      const noise = (x, y, k) => (((x * 37 + y * 91 + k * 53) ^ (x * y)) & 255) * 0.35 + 120 + ((x + y) % 7) * 6;
      const rgbRef = rawImage(640, 420, 3, 'DeviceRGB', noise);
      const grayRef = rawImage(500, 400, 1, 'DeviceGray', (x, y) => (x * 3 + y * 5) & 255);
      const cmykRef = rawImage(200, 150, 4, 'DeviceCMYK', (x, y, k) => k === 3 ? 20 : (x * (k + 1) + y) & 255);
      const maskRef = rawImage(160, 160, 1, 'DeviceGray', (x, y) => ((x - 80) ** 2 + (y - 80) ** 2 < 6000 ? 255 : 0));
      const maskedRef = rawImage(160, 160, 3, 'DeviceRGB', (x, y, k) => [220, 60 + y, 90 + x][k] & 255, { SMask: maskRef });
      const xo = ctx.obj({ ImRGB: rgbRef, ImGray: grayRef, ImCMYK: cmykRef, ImMasked: maskedRef });
      const res = p4.node.Resources();
      res.set(PDFName.of('XObject'), xo);
      const ops = 'q 300 0 0 200 40 560 cm /ImRGB Do Q q 200 0 0 160 360 600 cm /ImGray Do Q q 160 0 0 120 40 380 cm /ImCMYK Do Q q 120 0 0 120 260 380 cm /ImMasked Do Q';
      const cs = ctx.flateStream(ops);
      const contents = p4.node.get(PDFName.of('Contents'));
      const arr = contents instanceof PDFArray ? contents : ctx.obj(contents ? [contents] : []);
      arr.push(ctx.register(cs));
      p4.node.set(PDFName.of('Contents'), arr);
      doc.setTitle('Site report with photos');
      doc.setAuthor('Facilities team');
      files['images-heavy.pdf'] = b64(await doc.save());
    }

    /* 5. data */
    const header = ['Name', 'Employee ID', 'Month', 'Net pay', 'Date of birth', 'Email'];
    const rows = PEOPLE.map((p) => [p[0], p[1], p[2], p[3], p[4], p[0].toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com']);
    const csvCell = (v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    files['data.csv'] = btoa(unescape(encodeURIComponent([header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n')));
    const bad = [header,
      ['Priya Sharma', '10001', 'November 2026', '3,250.00', '1990-04-23', 'p@example.com'],
      ['Priya Sharma', '10013', 'November 2026', '1,000.00', '1993-02-02', 'p2@example.com'],
      ['Daniel Okafor', '10002', 'November 2026', '', '1985-11-02', 'd@example.com'],
      ['Amelia Chen', '10005', 'November 2026', '3,512.20', '', 'a@example.com']];
    files['bad-data.csv'] = btoa(unescape(encodeURIComponent(bad.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n')));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header].concat(rows.slice(0, 5).map((r) => [r[0], Number(r[1]), r[2], r[3], new Date(r[4] + 'T00:00:00'), r[5]])));
    XLSX.utils.book_append_sheet(wb, ws, 'November');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Note'], ['Second sheet']]), 'Notes');
    files['data.xlsx'] = b64(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
    return files;
  }, PEOPLE);
  for (const [name, data] of Object.entries(out)) {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log(name.padEnd(26), Buffer.from(data, 'base64').length, 'bytes');
  }
  if (page.errors.length) console.log('console errors:', page.errors);
  await browser.close();
  server.close();
})();
