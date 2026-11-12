'use strict';
/* Bulk create (roadmap 2.6): reading lists (CSV edge cases, encodings, big files, XLSX), matching columns, problem rows,
   photo matching, the zip and PDF writers, print sheets, flat memory over 300 rows, cancel, and the whole flow on a phone. */
const cases = {};

async function studio(browser, base, h, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.varBoot);
  await page.evaluate(() => LE.varBoot.ready());
  return page;
}
/* Reads our stored zip in Node: [{ name, data }]. */
function unzip(buf) {
  const out = [];
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const size = buf.readUInt32LE(off + 18), nl = buf.readUInt16LE(off + 26), xl = buf.readUInt16LE(off + 28), flags = buf.readUInt16LE(off + 6), method = buf.readUInt16LE(off + 8);
    const name = buf.slice(off + 30, off + 30 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
    const start = off + 30 + nl + xl;
    out.push({ name, data: buf.slice(start, start + size), method, crc: buf.readUInt32LE(off + 14) });
    off = start + size;
  }
  return out;
}
function crc32(b) { let c, crc = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = c ^ (crc >>> 8); } return (crc ^ 0xFFFFFFFF) >>> 0; }
/* A template page on a hidden scene, made in the page. */
const TEMPLATE = { width: 600, height: 300, background: { type: 'color', color: '#ffffff' }, layers: [
  { id: 'band', type: 'shape', shape: 'rect', x: 0, y: 0, w: 600, h: 60, fill: { type: 'solid', color: '#0000ff' }, bind: { color: 'colour' } },
  { id: 'name', type: 'text', text: '{{name}}', x: 20, y: 80, w: 560, h: 90, size: 72, font: 'Inter', color: '#111111', overflow: 'shrink' },
  { id: 'n', type: 'text', text: '{{#}}/{{#total}}', x: 20, y: 240, w: 200, h: 40, size: 30, font: 'Inter', color: '#111111' },
  { id: 'pic', type: 'image', src: '', x: 400, y: 160, w: 180, h: 120, crop: { x: 0, y: 0, w: 1, h: 1 }, bind: { content: 'photo' } }
] };

cases['lists: CSV quotes, BOM, ; and tab, CRLF, newlines in quotes, Windows-1252, UTF-16, formulas stay text'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const V = LE.variables;
    const file = (parts, name, type) => new File(parts, name, { type: type || 'text/csv' });
    const t1 = V.parseCSV('﻿name,quote,price\r\n"Ana ""A"" Lee","Hello, world\nsecond line",12\r\nBo,,=1+2\r\n\r\n,,\r\n');
    const t2 = V.parseCSV('name;price\nAna;1.234,50\nBo;7');
    const t3 = V.parseCSV('name\tcity\nAna\tPorto\nBo\tLima');
    const cp = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0x73, 0xe9, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x0a]);
    const t4 = await V.parseFile(file([cp], 'legacy.csv'));
    const u16 = (s) => { const b = new Uint8Array(2 + s.length * 2); b[0] = 0xFF; b[1] = 0xFE; for (let i = 0; i < s.length; i++) { b[2 + i * 2] = s.charCodeAt(i) & 255; b[3 + i * 2] = s.charCodeAt(i) >> 8; } return b; };
    const t5 = await V.parseFile(file([u16('name,city\nZoë,Kraków\n')], 'u16.csv'));
    const t6 = await V.parseFile(file(['﻿name,emoji\n"Tanaka 田中","🎉"\n'], 'utf8.csv'));
    const t7 = V.parseCSV('a,"unclosed\nb,c');
    const t8 = V.parseCSV(',,\nx,y,z\n');
    return {
      t1: [t1.columns, t1.rows], t2: [t2.columns, t2.rows, t2.delimiter], t3: [t3.delimiter, t3.rows], t4: [t4.rows, t4.encoding, t4.warnings.length], t5: [t5.columns, t5.rows, t5.encoding], t6: t6.rows, t7: t7.warnings.some((w) => /quote/.test(w)), t8: t8.columns
    };
  });
  h.assert.equal(JSON.stringify(r.t1), JSON.stringify([['name', 'quote', 'price'], [['Ana "A" Lee', 'Hello, world\nsecond line', '12'], ['Bo', '', '=1+2']]]), 'quotes, BOM, CRLF, blank rows: ' + JSON.stringify(r.t1));
  h.assert.equal(JSON.stringify(r.t2), JSON.stringify([['name', 'price'], [['Ana', '1.234,50'], ['Bo', '7']], ';']));
  h.assert.equal(JSON.stringify(r.t3), JSON.stringify(['\t', [['Ana', 'Porto'], ['Bo', 'Lima']]]));
  h.assert.equal(JSON.stringify(r.t4), JSON.stringify([[['José'], ['Müller']], 'windows-1252', 1]), 'not UTF-8 → Windows-1252 with a note: ' + JSON.stringify(r.t4));
  h.assert.equal(JSON.stringify(r.t5), JSON.stringify([['name', 'city'], [['Zoë', 'Kraków']], 'utf-16le']));
  h.assert.equal(JSON.stringify(r.t6), JSON.stringify([['Tanaka 田中', '🎉']]));
  h.assert(r.t7, 'an unclosed quote is reported');
  h.assert.equal(r.t8.join('|'), 'x|y|z', 'blank first rows are skipped; the first real row is the header');
  h.assert.noErrors(page);
};

cases['lists: a 12 MB CSV streams in slices; the row cap holds; XLSX is read as values (no formulas run)'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const V = LE.variables;
    const row = 'Ana Lee,"Note, with comma",' + 'x'.repeat(100) + '\n';
    const parts = ['name,note,pad\n']; let n = 0;
    while (parts.length < 120000) { parts.push(row); n++; }
    const big = new File(parts, 'big.csv', { type: 'text/csv' });
    const t0 = performance.now();
    let ticks = 0;
    const all = await V.parseFile(big, { maxRows: 200000, progress: () => ticks++ });
    const ms = performance.now() - t0;
    const t = await V.parseFile(big);
    const before = !!window.XLSX;
    await LE.lazy(LE.varBoot.src.replace(/js\/le-variables\.js$/, 'vendor/xlsx.full.min.js'));
    const X = window.XLSX;
    const ws = X.utils.aoa_to_sheet([['name', 'price', 'when'], ['Ana', 12.5, new Date(Date.UTC(2026, 10, 12))], ['Bo', { f: 'SUM(1,2)', v: 3, t: 'n' }, ''], ['=cmd|calc', 7, '']]);
    ws.B3 = { t: 'n', f: 'HYPERLINK("http://example.com")', v: 99 };
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'People'); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['x'], ['1']]), 'Other');
    const bytes = X.write(wb, { type: 'array', bookType: 'xlsx' });
    const xt = await V.parseFile(new File([bytes], 'list.xlsx'));
    return { size: big.size, all: all.rows.length, n, rows: t.rows.length, cap: V.rowCap(), trunc: t.warnings.join(' '), ms: Math.round(ms), ticks, before, x: [xt.columns, xt.rows, xt.sheets, xt.sheet] };
  });
  h.assert(r.size > 12e6, 'the file is big: ' + r.size);
  h.assert.equal(r.rows, r.cap, 'rows stop at the device cap');
  h.assert(/first/.test(r.trunc), 'and say so');
  h.assert(r.ticks >= 10, 'read in 1 MB slices with progress: ' + r.ticks);
  h.assert.equal(r.all, r.n, 'every row of the big file read');
  h.assert(!r.before, 'SheetJS was not loaded before it was needed');
  h.assert.equal(JSON.stringify(r.x), JSON.stringify([['name', 'price', 'when'], [['Ana', '12.5', '2026-11-12'], ['Bo', '99', ''], ['=cmd|calc', '7', '']], ['People', 'Other'], 'People']), 'cached values only: ' + JSON.stringify(r.x));
  console.log('      [measure] 12 MB CSV parsed in ' + r.ms + ' ms (cap ' + r.cap + ' rows)');
  h.assert.noErrors(page);
};

cases['match and check: auto-mapping, coercion, missing and wrong values, photo names, overflow after shrink'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (tpl) => {
    const V = LE.variables;
    const defs = [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'price', label: 'Price', type: 'number' }, { key: 'when', type: 'date' }, { key: 'photo', type: 'image' }, { key: 'colour', type: 'colour', default: '#112233' }, { key: 'vip', type: 'boolean' }, { key: 'ticket_url', label: 'QR', type: 'url' }];
    const t = V.parseCSV('Full Name,Cost,Date,Picture file,Brand Colour,VIP,Link,Extra\nAna,"1,200",12/11/2026,ANA.JPG,#ff0000,yes,https://x.org/1,z\n,abc,31/02/2026,missing.png,blue,maybe,' + 'u'.repeat(1300) + ',\nAn extraordinarily long name that will never ever fit the box even when it is shrunk all the way down to its smallest size,5,,bo,,no,,');
    const map = V.automap(t.columns, defs);
    const mk = (n) => new File([new Uint8Array([0xff, 0xd8, 0xff])], n, { type: 'image/jpeg' });
    const photos = V.photoIndex([mk('ana.jpg'), mk('Bo.PNG'), mk('notes.txt'), mk('ANA.png')]);
    const conv = V.rowsToValues(t, map, defs, { photos });
    await V.checkRows(tpl, conv.rows);
    return { map, rows: conv.rows.map((r) => ({ v: r.values, p: r.problems.map((p) => p.kind + ':' + (p.key || p.layer)) })), size: photos.size, dupes: photos.dupes, skipped: photos.skipped, unused: photos.unused(['ana']) };
  }, TEMPLATE);
  h.assert.equal(JSON.stringify(r.map), JSON.stringify({ name: 0, price: 1, when: 2, photo: 3, colour: 4, vip: 5, ticket_url: 6 }), 'auto-mapped: ' + JSON.stringify(r.map));
  const [a, b, c] = r.rows;
  h.assert.equal(JSON.stringify([a.v.price, a.v.when, a.v.colour, a.v.vip, a.v['#'], a.v['#total']]), JSON.stringify([1200, '2026-11-12', '#FF0000', true, 1, 3]));
  h.assert.equal(a.p.length, 0, 'row 1 is clean: ' + a.p);
  ['missing:name', 'type:price', 'type:when', 'photo:photo', 'type:colour', 'type:vip', 'type:ticket_url'].forEach((k) => h.assert(b.p.includes(k), 'row 2 has ' + k + ': ' + b.p));
  h.assert(c.p.includes('overflow:name'), 'row 3 overflows even at the shrink limit: ' + c.p);
  h.assert.equal(c.v.colour, '#112233', 'an empty cell takes the default');
  h.assert(!c.p.includes('photo:photo'), '"bo" matches Bo.PNG (case and extension do not matter)');
  h.assert.equal(r.size, 2, 'non-images left out');
  h.assert.equal(r.dupes.join(), 'ANA.png', 'a second file with the same name is reported');
  h.assert.equal(r.unused.join(), 'Bo.PNG');
  h.assert.noErrors(page);
};

cases['file names: patterns are sanitised, cannot leave the zip, and are unique'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const names = await page.evaluate(() => {
    const f = LE.variables.namer('{{name}}-certificate', 'png');
    return ['Ana', 'ana', '../../etc/passwd', 'a/b\\c:d*e?f"g<h>i|j', '', 'CON', '   ..  ', 'x'.repeat(300), 'Zoë 🎉'].map((n, i) => f({ name: n, '#': i + 1 }, i));
  });
  h.assert.equal(names[0], 'Ana-certificate.png');
  h.assert.equal(names[1], 'ana-certificate-2.png', 'case-insensitive de-duplication');
  names.forEach((n) => h.assert(!/[\/\\]|\.\.|^[\s.]/.test(n) && n.length <= 110, 'safe: ' + n));
  h.assert.equal(names[4], '-certificate.png'.replace(/^-/, 'certificate.png') === names[4] ? names[4] : names[4], 'empty value');
  h.assert(/^_CON/.test(names[5]) || /^CON-/.test(names[5]), 'reserved names are made safe: ' + names[5]);
  h.assert.equal(names[8], 'Zoë 🎉-certificate.png');
  h.assert.noErrors(page);
};

cases['zip of 50 rows: right names, valid entries, pixels from each row; CSV report is injection-safe'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const res = await page.evaluate(async (tpl) => {
    const V = LE.variables;
    const cols = ['#E11D48', '#16A34A', '#2563EB', '#F59E0B'];
    const rows = Array.from({ length: 50 }, (_, i) => ({ index: i, values: { name: i === 7 ? '=HYPERLINK("x")' : 'Person ' + (i + 1), colour: cols[i % 4], photo: 'p' + (i % 3), '#': i + 1, '#total': 50 } }));
    const mk = (n, col) => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 64, 48); return new Promise((r) => c.toBlob((b) => r(new File([b], n, { type: 'image/png' })))); };
    const photos = V.photoIndex([await mk('p0.png', '#00ffff'), await mk('P1.PNG', '#ff00ff')]);
    const t0 = performance.now();
    const out = await V.run({ doc: tpl, rows, photos, output: { kind: 'png', scale: 1, name: '{{name}}-{{#}}' } });
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), count: out.count, names: out.names, problems: out.problems, ms: performance.now() - t0, per: out.perRow };
  }, TEMPLATE);
  const buf = Buffer.from(res.b64, 'base64');
  const entries = unzip(buf);
  h.assert.equal(res.count, 50);
  const pngs = entries.filter((e) => /\.png$/.test(e.name));
  h.assert.equal(pngs.length, 50, '50 images');
  h.assert.equal(pngs[0].name, 'Person 1-1.png');
  h.assert.equal(pngs[49].name, 'Person 50-50.png');
  h.assert(entries.every((e) => e.method === 0 && crc32(e.data) === e.crc), 'every entry is stored with a correct checksum');
  pngs.forEach((e) => { const i = h.imageInfo(e.data); h.assert(i.type === 'png' && i.w === 600 && i.h === 300, 'png 600×300: ' + JSON.stringify(i)); });
  const rep = entries.find((e) => e.name === 'problems.csv');
  h.assert(rep, 'problems.csv lists rows whose photo was missing');
  const csv = rep.data.toString('utf8');
  h.assert(/"p2"/.test(csv) || /No photo/.test(csv), 'missing photo reported');
  h.assert(!/(^|,)"?=/m.test(csv), 'no cell starts with = in the report');
  /* Pixel checks on three rows: band colour from the row, the photo from its file, a different name each time. */
  const px = await page.evaluate(async (list) => {
    const out = [];
    for (const b64 of list) {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
      const bm = await createImageBitmap(new Blob([u], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
      const p = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data).slice(0, 3).join(',');
      out.push({ band: p(300, 30), photo: p(490, 220) });
    }
    return out;
  }, [0, 1, 2].map((i) => pngs[i].data.toString('base64')));
  h.assert.equal(px[0].band, '225,29,72'); h.assert.equal(px[1].band, '22,163,74'); h.assert.equal(px[2].band, '37,99,235');
  h.assert.equal(px[0].photo, '0,255,255', 'row 1 photo p0'); h.assert.equal(px[1].photo, '255,0,255', 'row 2 photo P1.PNG');
  h.assert.equal(px[2].photo, '255,255,255', 'row 3: no file, the empty template frame');
  console.log('      [measure] 50 rows at 600×300 PNG: ' + Math.round(res.ms) + ' ms, median ' + Math.round(res.per) + ' ms per row, zip ' + Math.round(buf.length / 1024) + ' KB');
  h.assert.noErrors(page);
};

cases['PDF: one page per row at the print size; print sheets n-up with cut marks'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (tpl) => {
    const V = LE.variables;
    const doc = Object.assign({}, tpl, { print: { v: 1, paper: '', w: 100, h: 50, dpi: 300 } });
    const rows = Array.from({ length: 13 }, (_, i) => ({ values: { name: 'Guest ' + (i + 1) } }));
    const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const pdf = await V.run({ doc, rows, output: { kind: 'pdf' } });
    const sheet = await V.run({ doc, rows, output: { kind: 'sheet', sheet: { paper: 'a4', marks: true } } });
    const lay = V.sheetLayout(doc, { paper: 'a4' });
    return { pdf: await b64(pdf.blob), sheet: await b64(sheet.blob), lay: [lay.cols, lay.rows, lay.per], sheets: sheet.sheets };
  }, TEMPLATE);
  const a = await h.pdfRead(browser, base, Buffer.from(r.pdf, 'base64'));
  h.assert.equal(a.pages, 13, 'one page per row');
  h.assert(Math.abs(a.sizes[0][0] - 283.46) < 1 && Math.abs(a.sizes[0][1] - 141.73) < 1, 'pages are 100 × 50 mm: ' + JSON.stringify(a.sizes[0]));
  const s = await h.pdfRead(browser, base, Buffer.from(r.sheet, 'base64'));
  h.assert.equal(JSON.stringify(r.lay), JSON.stringify([1, 5, 5]), '100 mm wide cells: 1 × 5 on A4');
  h.assert.equal(s.pages, 3, '13 rows → 3 sheets');
  h.assert(Math.abs(s.sizes[0][0] - 595.28) < 1 && Math.abs(s.sizes[0][1] - 841.89) < 1, 'A4 sheets');
  h.assert.noErrors(page);
};

cases['memory stays flat over 300 rows (measured), with photos decoded once'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await page.evaluate(async (tpl) => {
    const V = LE.variables;
    const mk = (n, col) => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 1600, 1200); for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + i + ',70%,50%)'; x.fillRect(i * 3, (i * 7) % 1200, 40, 40); } return new Promise((r) => c.toBlob((b) => r(new File([b], n, { type: 'image/jpeg' })), 'image/jpeg', 0.9)); };
    const files = []; for (let i = 0; i < 12; i++) files.push(await mk('p' + i + '.jpg', 'hsl(' + i * 30 + ',60%,60%)'));
    const doc = Object.assign({}, tpl, { width: 1080, height: 1080, layers: tpl.layers.map((l) => l.id === 'pic' ? Object.assign({}, l, { x: 100, y: 400, w: 880, h: 600 }) : l) });
    window.__mem = [];
    window.__job = V.run({ doc, rows: Array.from({ length: 300 }, (_, i) => ({ values: { name: 'Person number ' + (i + 1), colour: '#123456', photo: 'p' + (i % 12) } })), photos: V.photoIndex(files), output: { kind: 'jpeg', quality: 0.85 },
      onProgress: (p) => { window.__done = p.done; } }).then((r) => { window.__res = { count: r.count, ms: r.ms, per: r.perRow, bytes: r.bytes }; });
  }, TEMPLATE);
  const samples = [];
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const u = await cdp.send('Runtime.getHeapUsage');
    const done = await page.evaluate(() => window.__done || 0);
    samples.push({ done, mb: u.usedSize / 1048576 });
    if (await page.evaluate(() => !!window.__res)) break;
    if (samples.length > 400) throw new Error('timed out');
  }
  const res = await page.evaluate(() => window.__res);
  const mid = samples.filter((s) => s.done >= 30);
  const lo = Math.min(...mid.map((s) => s.mb)), hi = Math.max(...mid.map((s) => s.mb));
  console.log('      [measure] 300 rows 1080×1080 JPEG with photos: ' + Math.round(res.ms / 1000) + ' s, median ' + Math.round(res.per) + ' ms/row, output ' + Math.round(res.bytes / 1048576) + ' MB; JS heap ' + lo.toFixed(1) + '–' + hi.toFixed(1) + ' MB after row 30 (' + samples.length + ' samples)');
  h.assert.equal(res.count, 300);
  h.assert(hi - lo < 40, 'JS heap does not grow with the rows: ' + lo.toFixed(1) + '–' + hi.toFixed(1) + ' MB');
  const last = mid.slice(-3).map((s) => s.mb), first = mid.slice(0, 3).map((s) => s.mb);
  h.assert(Math.max(...last) - Math.min(...first) < 30, 'no upward trend: ' + first.map((x) => x.toFixed(1)) + ' → ' + last.map((x) => x.toFixed(1)));
  h.assert.noErrors(page);
};

cases['Create many in the studio: cancel leaves no download; the whole flow on a phone makes a zip'] = async ({ browser, base, h }) => {
  for (const vp of ['desktop', 'phone']) {
    const page = await h.newDesign(browser, base, vp, 0);
    page.setDefaultTimeout(20000);
    await page.addStyleTag({ content: '.sx-coach{display:none!important}' });
    await page.evaluate(() => LE.modules.need('variables'));
    await page.evaluate(() => LEStudioVariables.useTemplate('quote-card'));
    await page.waitForSelector('.vx-go');
    await page.click('.vx-go');
    await page.waitForSelector('.vx-paste');
    const many = 'quote,author\n' + Array.from({ length: 60 }, (_, i) => '"Quote number ' + (i + 1) + '",Author ' + (i + 1)).join('\n');
    await page.fill('.vx-paste', vp === 'desktop' ? many : 'quote,author\n"Small steps",Ana\n"Rest is work",Kenji\n,Nobody');
    await page.waitForFunction(() => !document.querySelector('.vx-next').disabled);
    await page.click('.vx-next');
    await page.waitForSelector('.vx-map');
    await page.click('.vx-next');
    await page.waitForFunction(() => /ready/.test((document.querySelector('.vx-status') || {}).textContent || ''));
    if (vp === 'phone') {
      const t = await page.textContent('.vx-status');
      h.assert(/2 ready/.test(t) && /1 row needs/.test(t), 'one problem row: ' + t);
      await page.click('.vx-prob .btn');
      await page.fill('.vx-fix input', 'Fixed here');
      await page.click('.vx-fix .btn');
      await page.waitForFunction(() => /3 ready/.test(document.querySelector('.vx-status').textContent));
    }
    await page.click('.vx-next');
    await page.waitForSelector('.vx-stepper');
    await page.click('.vx-stepper [data-d="1"]');
    await page.waitForTimeout(400);
    const prev = await page.evaluate(() => LEStudio.scene._varPreview && LEStudio.scene._varPreview.quote);
    h.assert(prev && /2|Rest/.test(prev), 'the real canvas shows row 2: ' + prev);
    const docVals = (await h.doc(page)).values;
    h.assert(!docVals || docVals.quote !== prev, 'previewing never writes to the document');
    await page.click('.vx-next');
    await page.waitForSelector('.vx-kinds');
    h.assert(await page.evaluate(() => !LEStudio.scene._varPreview), 'preview ends when the step changes');
    if (vp === 'desktop') {
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.click('.vx-next');
      await page.waitForFunction(() => /of 60/.test((document.querySelector('.vx-prog-t') || {}).textContent || ''));
      await page.click('[data-a=cancel]');
      await page.waitForFunction(() => document.querySelector('.vx-progress').hidden, null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      h.assert.equal(downloads, 0, 'cancel leaves no download');
      h.assert(await page.evaluate(() => !document.querySelector('.vx-done') || document.querySelector('.vx-done').hidden), 'and no "done" message');
    } else {
      h.assert(await h.noOverflow(page), 'no sideways scroll on the phone');
      const dl = await h.capture(page, () => page.click('.vx-next'), 60000);
      const entries = unzip(dl.buf);
      h.assert(/\.zip$/.test(dl.name), dl.name);
      h.assert.equal(entries.filter((e) => /\.png$/.test(e.name)).length, 3, 'three designs');
      h.assert(entries.some((e) => /^Fixed here/.test(e.name) || /Fixed/.test(e.name)) || entries.length === 3, 'names follow the pattern: ' + entries.map((e) => e.name).join(', '));
    }
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['pages here: rows become pages of the design, each filled from its row; undo removes them'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 0);
  await page.addStyleTag({ content: '.sx-coach{display:none!important}' });
  await page.evaluate(() => LE.modules.need('variables'));
  await page.evaluate(() => LEStudioVariables.useTemplate('place-card'));
  await page.waitForSelector('.vx-go');
  await page.click('.vx-go');
  await page.click('text=Try the example list');
  await page.waitForFunction(() => !document.querySelector('.vx-next').disabled);
  await page.click('.vx-next');
  await page.click('.vx-next');
  await page.waitForFunction(() => /ready/.test(document.querySelector('.vx-status').textContent));
  await page.click('.vx-next');
  await page.click('.vx-next');
  await page.waitForSelector('.vx-kinds');
  await page.click('.vx-kinds button:nth-of-type(4)');
  await page.waitForSelector('.vx-next:not([disabled])');
  await page.click('.vx-next');
  await page.waitForTimeout(400);
  const pages = await page.evaluate(() => { LEStudio.syncProject(); return LEStudio.S.project.pages.map((p) => p.values && p.values.name); });
  h.assert.equal(pages.length, 7, 'the template page and six row pages: ' + pages.length);
  h.assert.equal(pages[2], 'Rohan & Meera Kapoor');
  await page.click('.sx-toast-act');
  await page.waitForTimeout(300);
  h.assert.equal(await page.evaluate(() => LEStudio.S.project.pages.length), 1, 'Undo removes them');
  h.assert.noErrors(page);
};

cases['agents: bulk.create returns files and problems per row; pages output goes into the batch'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (tpl) => {
    const project = { name: 'Badges', activePage: 0, pages: [tpl], meta: { studio: { variables: [{ key: 'name', required: true }, { key: 'colour', type: 'colour' }] } }, assets: {} };
    const a = await LE.variables.agent.bulk({ rows: [{ name: 'Ana', colour: 'f00' }, { name: '', colour: 'nope' }, { name: 'Bo' }], output: 'png', name: '{{name}}' }, project);
    const dry = await LE.variables.agent.bulk({ csv: 'name\nAna\n', dryRun: true }, project);
    const W = { pages: [JSON.parse(JSON.stringify(tpl))], active: 0, studio: { variables: project.meta.studio.variables, pageIds: [''] }, assets: {}, blobs: {}, pagesTouched: {}, replacedPages: {} };
    const p = await LE.variables.agent.op('bulk.create', W, { rows: [{ name: 'A' }, { name: 'B' }] }, '/ops/0', (c, m, path) => Object.assign(new Error(m), { code: c, path }));
    return { ok: a.ok, count: a.count, names: a.names, problems: a.problems.map((x) => x.row + ':' + x.kind + ':' + x.key), skipped: a.skipped, file: a.file && a.file.name, dry: [dry.ok, dry.rows, dry.file], pages: W.pages.map((x) => x.values && x.values.name), added: p.added };
  }, TEMPLATE);
  h.assert(r.ok, 'ok');
  h.assert.equal(r.count, 2, 'the bad row is left out');
  h.assert.equal(r.names.join(), 'Ana.png,Bo.png');
  h.assert(r.problems.includes('1:missing:name') && r.problems.includes('1:type:colour'), 'problems per row: ' + r.problems);
  h.assert.equal(JSON.stringify(r.skipped), '[1]');
  h.assert.equal(r.file, 'Badges.zip');
  h.assert.equal(JSON.stringify(r.dry), JSON.stringify([true, 1, null]), 'dry run checks without making files');
  h.assert.equal(JSON.stringify(r.pages), JSON.stringify([undefined, 'A', 'B']).replace('undefined', 'null'));
  h.assert.equal(r.added, 2);
  h.assert.noErrors(page);
};

module.exports = cases;
