/* Searchable-text PDFs from the converter (QA-010): LE.pdfFlow (assets/js/le-pdf-flow.js) and the Convert to PDF page.
   Fixtures: scripts/fixtures/sample.* and tests/fixtures/pdf-docs/ (made by make-fixtures.py there). */
'use strict';
const path = require('path');

const FX = '/tests/fixtures/pdf-docs/';

/* The convert page with helpers:
   __conv(url, opts) → { b64, pages, mode, warnings, size }    LE.convert.toPDF on a fetched fixture
   __flow(html, opts) → same for LE.pdfFlow.render
   __read(bytes) → { pages, sizes, text: [per page], outline: [titles, nested flattened with '>' ], links: [urls], images } */
async function conv(h, browser, base, vp) {
  const page = await h.open(browser, base, '/convert-to-pdf/', vp || 'desktop');
  page.setDefaultTimeout(60000);
  page.foreign = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) page.foreign.push(u); });
  await page.waitForFunction(() => window.LE && LE.lazy);
  await page.evaluate(async () => {
    await LE.lazy('../assets/js/le-convert.js');
    window.__file = async (u) => { const r = await fetch(u); return new File([await r.arrayBuffer()], u.split('/').pop()); };
    window.__read = async (bytes) => {
      if (!window.pdfjsLib) await LE.lazy('../assets/vendor/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '../assets/vendor/pdf.worker.min.js';
      const d = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
      const out = { pages: d.numPages, sizes: [], text: [], links: [], outline: [], images: 0 };
      for (let i = 1; i <= d.numPages; i++) {
        const p = await d.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        out.sizes.push([Math.round(vp.width), Math.round(vp.height)]);
        const tc = await p.getTextContent();
        out.text.push(tc.items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join(''));
        (await p.getAnnotations()).forEach((a) => { if (a.subtype === 'Link') out.links.push(a.url || (a.dest ? '#dest' : '')); });
        const ops = await p.getOperatorList();
        ops.fnArray.forEach((f) => { if (f === pdfjsLib.OPS.paintImageXObject || f === pdfjsLib.OPS.paintJpegXObject) out.images++; });
        p.cleanup();
      }
      const walk = (items, pre) => (items || []).forEach((o) => { out.outline.push(pre + o.title); walk(o.items, pre + o.title + ' > '); });
      walk(await d.getOutline(), '');
      d.destroy();
      return out;
    };
    const pack = async (r, t0) => {
      const info = await window.__read(r.bytes);
      return { pages: r.pageCount, mode: r.mode || null, warnings: r.warnings || [], size: r.bytes.length, ms: Math.round(performance.now() - t0), read: info };
    };
    window.__conv = async (u, opts) => { const t0 = performance.now(); return pack(await LE.convert.toPDF(await window.__file(u), opts || {}), t0); };
    window.__flow = async (html, opts) => { await LE.lazy('../assets/js/le-pdf-flow.js'); const t0 = performance.now(); return pack(await LE.pdfFlow.render(html, opts || {}), t0); };
  });
  return page;
}
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
/* every needle appears, in this order */
function inOrder(h, text, needles, label) {
  let at = 0;
  const t = flat(text);
  needles.forEach((n) => {
    const i = t.indexOf(n, at);
    h.assert(i >= 0, label + ': "' + n + '" missing or out of order after position ' + at + ' in "' + t.slice(Math.max(0, at - 60), at + 120) + '"');
    at = i + n.length;
  });
}

const cases = {};

cases['QA-010: a Word report becomes real text with headings, links, outline, repeated table headers and a small file'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const r = await page.evaluate((u) => window.__conv(u, { pageNumbers: true }), FX + 'report.docx');
  h.assert.equal(r.mode, 'text', 'written as text');
  const all = r.read.text.join('\n');
  inOrder(h, all, ['Quarterly operations report', 'Prepared for the leadership team', '1. Summary', 'bold findings', 'italic remarks', 'underlined dates',
    'withdrawn figures', 'caf\u00E9, na\u00EFve, Zo\u00EB, \u0141\u00F3d\u017A, Stra\u00DFe, \u0110\u00E0 N\u1EB5ng', '2. What changed', '2.1 Tools', 'Shared drive for forms', '2.2 Steps we followed',
    '1. Collect every paper form', '2. Scan and name each file', '3. Costs by month', 'Month Item Supplier Amount Notes', 'January Line item 01',
    'Line item 72', '4. Floor plan', 'Figure 1. The new layout of the front office.', '5. Other languages',
    'Greek: \u0397 \u03B1\u03BD\u03B1\u03C6\u03BF\u03C1\u03AC \u03B5\u03AF\u03BD\u03B1\u03B9 \u03AD\u03C4\u03BF\u03B9\u03BC\u03B7. Russian: \u041E\u0442\u0447\u0451\u0442 \u0433\u043E\u0442\u043E\u0432 \u043A \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0435. Ukrainian: \u0417\u0432\u0456\u0442 \u0433\u043E\u0442\u043E\u0432\u0438\u0439.', 'Vietnamese: B\u00E1o c\u00E1o \u0111\u00E3 s\u1EB5n s\u00E0ng.', '6. Closing'], 'report.docx');
  for (let i = 1; i <= 72; i++) h.assert(flat(all).indexOf('Line item ' + String(i).padStart(2, '0')) >= 0, 'table row ' + i + ' is in the text');
  /* the table runs over several pages and its header row repeats on each */
  const tablePages = r.read.text.filter((t) => /Line item \d\d/.test(t));
  h.assert(tablePages.length >= 2, 'the table spans pages: ' + tablePages.length);
  tablePages.forEach((t, i) => h.assert(/Month\s*Item\s*Supplier\s*Amount\s*Notes/.test(t), 'header row on table page ' + (i + 1)));
  h.assert(r.pages >= 4 && r.pages <= 8, 'sensible page count: ' + r.pages);
  h.assert(/1 \/ \d/.test(r.read.text[0]) || /Page 1 of/.test(r.read.text[0]) || /1\s*\/\s*\d/.test(r.read.text[0]), 'page number footer: ' + r.read.text[0].slice(-40));
  h.assert(r.read.links.indexOf('https://example.org/ops') >= 0, 'the Word hyperlink is a clickable link: ' + JSON.stringify(r.read.links));
  ['Quarterly operations report', '1. Summary', '2. What changed', '2. What changed > 2.1 Tools', '3. Costs by month', '6. Closing'].forEach((t) => h.assert(r.read.outline.indexOf(t) >= 0, 'outline has "' + t + '": ' + JSON.stringify(r.read.outline)));
  h.assert(r.read.images === 1, 'the floor-plan image is embedded once: ' + r.read.images);
  h.assert(r.size < 120000, 'small file: ' + r.size);
  /* the old picture path for comparison */
  const pic = await page.evaluate((u) => window.__conv(u, { output: 'picture' }), FX + 'report.docx');
  h.assert.equal(pic.mode, 'picture', 'output: picture is still available');
  h.assert(flat(pic.read.text.join('')).length === 0, 'picture pages carry no text');
  h.assert(r.size * 10 < pic.size, 'text PDF is far smaller than the picture PDF: ' + r.size + ' vs ' + pic.size);
  h.assert.noErrors(page);
  h.assert.equal(page.foreign.length, 0, 'no cross-origin requests: ' + page.foreign.join(', '));
};

cases['QA-010: the original fixtures (DOCX, Markdown, HTML, TXT, CSV, XLSX, ODT, RTF, EPUB) keep their text in order'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const want = {
    'sample.docx': ['LEDOCXHEADING', 'Section two', 'A paragraph with bold and italic words.', 'First list item', 'Name Value', 'Alpha 1', 'Docx filler paragraph 1.', 'Docx filler paragraph 36.'],
    'sample.md': ['LEMDTITLE', 'A paragraph with bold and italic text.', 'Details', 'Alpha', 'Beta', '1. First', '2. Second', 'Col Val', 'A 1', 'code line LECODE'],
    'sample.html': ['LEHTMLSAFE', 'This paragraph stays.', 'Styled text', 'link text'],
    'sample.txt': [], 'sample.csv': [], 'sample.xlsx': [], 'sample.odt': [], 'sample.rtf': [], 'sample.epub': []
  };
  const sizes = {};
  for (const f of Object.keys(want)) {
    const r = await page.evaluate((u) => window.__conv(u, {}), '/scripts/fixtures/' + f);
    const text = flat(r.read.text.join(' '));
    h.assert(text.length > 10, f + ' has a text layer (' + r.size + ' bytes)');
    if (want[f].length) inOrder(h, text, want[f], f);
    sizes[f] = r.size;
    if (/\.(docx|md|html|odt|epub)$/.test(f)) h.assert.equal(r.mode, 'text', f + ' written as text');
  }
  /* QA-010 numbers: the 3-page DOCX was 765 KB and the 1-page Markdown 52 KB as pictures */
  h.assert(sizes['sample.docx'] < 60000, 'sample.docx is ' + sizes['sample.docx'] + ' bytes (was 765 KB)');
  h.assert(sizes['sample.md'] < 30000, 'sample.md is ' + sizes['sample.md'] + ' bytes (was 52 KB)');
  h.assert.noErrors(page);
};

cases['QA-010: Markdown handbook keeps code, quotes, nested lists, tables, links and an outline'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const r = await page.evaluate((u) => window.__conv(u, {}), FX + 'handbook.md');
  const all = r.read.text.join('\n');
  inOrder(h, all, ['Handbook for new staff', 'Section 1: topic B', 'Paragraph 1.1.', 'First point for section 1', 'inline code', 'Nested point', 'A quoted remark from the team in section 1.',
    'Section 2: topic C', 'function total(items) { // section 2', 'return items.reduce((sum, item) => sum + item.price * item.quantity, 0);',
    'Section 3: topic D', 'Code Description Qty', 'C-300 Item for section 3 row 0 1', 'C-305 Item for section 3 row 5 16', 'Section 8: topic I'], 'handbook.md');
  h.assert(r.read.links.indexOf('https://example.org/policy') >= 0, 'markdown link kept: ' + JSON.stringify(r.read.links));
  h.assert(r.read.outline.length >= 9, 'outline from headings: ' + r.read.outline.length);
  h.assert(r.read.outline.indexOf('Handbook for new staff > Section 3: topic D') >= 0, 'h2 nested under h1: ' + JSON.stringify(r.read.outline.slice(0, 4)));
  h.assert(r.size < 60000, 'size ' + r.size);
};

cases['QA-010: a wide workbook becomes landscape text tables with sheet headings and the header row on every page'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const r = await page.evaluate((u) => window.__conv(u, {}), FX + 'wide.xlsx');
  h.assert(r.read.sizes[0][0] > r.read.sizes[0][1], 'landscape: ' + JSON.stringify(r.read.sizes[0]));
  const all = flat(r.read.text.join(' '));
  for (let i = 1; i <= 120; i++) h.assert(all.indexOf('SO-' + String(i).padStart(5, '0')) >= 0, 'order ' + i + ' present');
  h.assert(all.indexOf('0007919') >= 0, 'leading zeros kept');
  const orderPages = r.read.text.filter((t) => /SO-\d{5}/.test(t));
  h.assert(orderPages.length >= 2, 'several pages of orders');
  orderPages.forEach((t, i) => h.assert(/Order\s*Date\s*Customer\s*City/.test(t), 'header repeated on orders page ' + (i + 1)));
  h.assert(r.read.outline.indexOf('Orders') >= 0 && r.read.outline.indexOf('Summary') >= 0, 'sheet names are bookmarks: ' + JSON.stringify(r.read.outline));
  inOrder(h, all, ['Summary', 'Region Orders Revenue', 'North 40 12000.5'], 'summary sheet');
};

cases['QA-010: hostile HTML runs nothing, fetches nothing, drops javascript: links and keeps the text'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const hostile = '<h1 onclick="window.__pwn=1">Hostile LEHOST</h1><script>window.__pwn=2;parent.__pwn=2</script>' +
    '<img src="x" onerror="window.__pwn=3"><img src="https://example.com/probe.png" alt="probe"><iframe src="https://example.com/"></iframe>' +
    '<p>See <a href="javascript:window.__pwn=4">bad link</a>, <a href="https://example.com/ok">good link</a>, <a href="#tgt">inside</a>.</p>' +
    '<svg><script>window.__pwn=5</script></svg><style>body{background:url(https://example.com/bg.png)}</style>' +
    '<p style="background:url(https://example.com/x.png);color:#ffffff">white text LEWHITE</p><p id="tgt">Target LETGT</p>';
  const r = await page.evaluate(async (html) => {
    const viaConvert = await window.__conv(URL.createObjectURL(new Blob([html], { type: 'text/html' })), {});
    return { viaConvert, pwn: window.__pwn || null };
  }, hostile).catch(async () => null);
  /* blob: URL names have no extension, so also run the HTML through LE.convert.toPDF as a named file */
  const r2 = await page.evaluate(async (html) => {
    const res = await LE.convert.toPDF(new File([html], 'hostile.html', { type: 'text/html' }), {});
    return { read: await window.__read(res.bytes), mode: res.mode, pwn: window.__pwn || null };
  }, hostile);
  h.assert.equal(r2.mode, 'text', 'written as text');
  inOrder(h, r2.read.text.join(' '), ['Hostile LEHOST', 'See bad link, good link, inside.', 'white text LEWHITE', 'Target LETGT'], 'hostile');
  h.assert(r2.read.links.indexOf('https://example.com/ok') >= 0, 'web link kept');
  h.assert(r2.read.links.every((u) => !/javascript/i.test(u)), 'no javascript: link: ' + JSON.stringify(r2.read.links));
  h.assert(r2.read.links.indexOf('#dest') >= 0, 'in-document link points at the target');
  h.assert(r2.pwn === null && (!r || r.pwn === null), 'nothing ran');
  h.assert.equal(page.foreign.length, 0, 'nothing fetched: ' + page.foreign.join(', '));
};

cases['QA-010: 5,000 paragraphs, a 3,000-row table, 2,000 levels of nesting and a 200-column table finish in time'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const r = await page.evaluate(async () => {
    const out = {};
    const p = []; for (let i = 0; i < 5000; i++) p.push('<p>Paragraph LEP' + i + ' with some words to wrap and measure.</p>');
    let x = await window.__flow(p.join(''), {});
    const t = x.read.text.join(' ');
    out.paras = { ms: x.ms, pages: x.pages, first: t.indexOf('LEP0 ') >= 0, last: t.indexOf('LEP4999 ') >= 0, every: [0, 1234, 2500, 4321, 4999].every((i) => t.indexOf('LEP' + i + ' ') >= 0) };
    const rows = []; for (let i = 0; i < 3000; i++) rows.push('<tr><td>ROW' + i + '</td><td>text ' + i + '</td><td>' + (i * 3.5) + '</td></tr>');
    x = await window.__flow('<table><thead><tr><th>HA</th><th>HB</th><th>HC</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>', {});
    const pagesWithHead = x.read.text.filter((s) => /HA\s*HB\s*HC/.test(s)).length;
    out.table = { ms: x.ms, pages: x.pages, head: pagesWithHead, last: x.read.text.join(' ').indexOf('ROW2999') >= 0 };
    let deep = ''; for (let i = 0; i < 2000; i++) deep += '<div><blockquote><ul><li>'; deep += 'DEEPTEXT'; for (let i = 0; i < 2000; i++) deep += '</li></ul></blockquote></div>';
    x = await window.__flow(deep, {});
    out.deep = { ms: x.ms, text: x.read.text.join(' ').indexOf('DEEPTEXT') >= 0 };
    x = await window.__flow('<table><tr>' + Array.from({ length: 200 }, (_, i) => '<td colspan="3">c' + i + '</td>').join('') + '</tr></table><p>' + 'W'.repeat(4000) + '</p>', {});
    out.wide = { ms: x.ms, pages: x.pages };
    return out;
  });
  h.assert(r.paras.every && r.paras.last && r.paras.ms < 25000 && r.paras.pages > 100, '5,000 paragraphs: ' + JSON.stringify(r.paras));
  h.assert(r.table.last && r.table.head === r.table.pages && r.table.ms < 25000, '3,000 rows, header on every page: ' + JSON.stringify(r.table));
  h.assert(r.deep.text && r.deep.ms < 15000, 'deep nesting: ' + JSON.stringify(r.deep));
  h.assert(r.wide.ms < 10000 && r.wide.pages >= 1, 'wide table and a 4,000-letter word: ' + JSON.stringify(r.wide));
  h.assert.noErrors(page);
};

cases['QA-010: Arabic, Hebrew or CJK documents fall back to pictures, labelled; Greek and Cyrillic stay text'] = async ({ browser, base, h }) => {
  const page = await conv(h, browser, base);
  const r = await page.evaluate(async () => {
    const run = async (html, name) => { const res = await LE.convert.toPDF(new File([html], name), {}); return { mode: res.mode, warnings: res.warnings, read: await window.__read(res.bytes) }; };
    return {
      ar: await run('<h1>Report</h1><p>\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645</p>', 'ar.html'),
      he: await run('<p>\u05E9\u05DC\u05D5\u05DD \u05E2\u05D5\u05DC\u05DD</p>', 'he.md'),
      zh: await run('<p>\u4F60\u597D\uFF0C\u4E16\u754C</p>', 'zh.html'),
      gr: await run('<p>\u039A\u03B1\u03BB\u03B7\u03BC\u03AD\u03C1\u03B1 \u03BA\u03CC\u03C3\u03BC\u03B5. \u041F\u0440\u0438\u0432\u0435\u0442, \u043C\u0438\u0440. \u0110\u00E0 N\u1EB5ng.</p>', 'gr.html'),
      check: LE.pdfFlow.scriptsIn('\u0939\u093F\u0928\u094D\u0926\u0940 \u0E44\u0E17\u0E22')
    };
  });
  ['ar', 'he', 'zh'].forEach((k) => {
    h.assert.equal(r[k].mode, 'picture', k + ' falls back to pictures');
    h.assert(r[k].warnings.some((w) => /^Saved as pictures/.test(w)), k + ' is labelled: ' + JSON.stringify(r[k].warnings));
    h.assert(r[k].read.images >= 1, k + ' has page pictures');
  });
  h.assert.equal(r.gr.mode, 'text', 'Greek and Cyrillic are text');
  h.assert(flat(r.gr.read.text.join(' ')).indexOf('\u039A\u03B1\u03BB\u03B7\u03BC\u03AD\u03C1\u03B1 \u03BA\u03CC\u03C3\u03BC\u03B5. \u041F\u0440\u0438\u0432\u0435\u0442, \u043C\u0438\u0440. \u0110\u00E0 N\u1EB5ng.') >= 0, 'exact Greek/Cyrillic/Vietnamese text: ' + r.gr.read.text.join(' '));
  h.assert(r.check.unsupported.indexOf('Devanagari') >= 0 && r.check.unsupported.indexOf('Thai') >= 0, 'scriptsIn names the scripts: ' + JSON.stringify(r.check));
};

cases['QA-010: the convert page offers searchable text by default, shows size and what the file contains, and can switch to pictures'] = async ({ browser, base, h }) => {
  for (const vp of ['desktop', 'phone']) {
    const page = await h.open(browser, base, '/convert-to-pdf/', vp);
    page.setDefaultTimeout(60000);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose files/ }).click()]);
    await fc.setFiles(path.join(h.ROOT, 'scripts', 'fixtures', 'sample.docx'));
    await page.waitForFunction(() => /Text can be selected and searched/.test(document.getElementById('cv-prev-meta').textContent));
    const ui = await page.evaluate(() => {
      const on = document.querySelector('[data-opt="output"] [aria-pressed="true"]');
      const btns = [...document.querySelectorAll('[data-opt="output"] button')].map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, text: b.textContent }; });
      return { on: on && on.getAttribute('data-v'), btns, meta: document.getElementById('cv-prev-meta').textContent };
    });
    h.assert.equal(ui.on, 'text', vp + ': searchable text is the default');
    h.assert(/Searchable text/.test(ui.btns[0].text) && /Exact picture of each page/.test(ui.btns[1].text), vp + ': both choices are named');
    ui.btns.forEach((b) => h.assert(b.h >= 44, vp + ': output buttons are 44 px tall: ' + b.h));
    h.assert(/\d+(\.\d+)? KB/.test(ui.meta), vp + ': size shown: ' + ui.meta);
    if (vp === 'desktop') {
      const r = await h.capture(page, () => page.click('[data-cv="download"]'), 60000);
      const info = await h.pdfRead(browser, base, r.buf);
      h.assert(flat(info.text).indexOf('LEDOCXHEADING') >= 0, 'downloaded PDF has text');
      await page.click('[data-opt="output"] [data-v="picture"]');
      await page.waitForFunction(() => /Pages are pictures/.test(document.getElementById('cv-prev-meta').textContent));
      h.assert(/picture/.test(await page.textContent('#cv-out-hint')), 'the hint explains the picture choice');
      const r2 = await h.capture(page, () => page.click('[data-cv="download"]'), 60000);
      const info2 = await h.pdfRead(browser, base, r2.buf);
      h.assert(flat(info2.text) === '', 'picture PDF has no text');
      h.assert(r2.size > r.size * 5, 'pictures are much larger: ' + r2.size + ' vs ' + r.size);
      h.assert(/Pages are pictures/.test(await page.textContent('#cv-bar-meta')), 'bar says pages are pictures');
    } else {
      h.assert(await h.noOverflow(page), 'no sideways scroll on a phone');
    }
    h.assert.noErrors(page);
    await page.context().close();
  }
};

module.exports = cases;
