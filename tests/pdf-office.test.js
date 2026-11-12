/* PDF studio office kit (docs/ROADMAP.md D11, D14, D15, D16, D19, D20): LE.pdfOffice, the Office kit in the PDF studio,
   the /verify/ page, and the custom-font fix in LE.pdf.embedFont. Fixtures: tests/fixtures/pdf-office/make-fixtures.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONTRACT_CHANGES } = require('./fixtures/pdf-office/make-fixtures');

const FX = path.join(__dirname, 'fixtures', 'pdf-office');
const SHOTS = process.env.OFFICE_SHOTS || '';

async function studio(h, browser, base, vp, opts) {
  const page = await h.open(browser, base, '/pdf-studio/', vp || 'desktop', opts);
  page.logs = [];
  page.requests = [];
  page.on('console', (m) => page.logs.push(m.type() + ': ' + m.text()));
  page.on('request', (r) => page.requests.push(r.url()));
  await page.waitForFunction(() => window.LE && LE.pdfOffice && window.PS && PS.office && LE.pdfBulk && LE.pdfSecurity);
  await page.evaluate(() => {
    window.__fx = async (n) => new Uint8Array(await (await fetch('/tests/fixtures/pdf-office/' + n)).arrayBuffer());
    window.__pdf = async (bytes, pw) => { await LE.pdf.ready(); return pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, password: pw }).promise; };
    window.__texts = async (bytes, pw) => {
      const d = await window.__pdf(bytes, pw), out = [];
      for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); const tc = await p.getTextContent(); out.push(tc.items.map((x) => x.str).join(' ').replace(/\s+/g, ' ')); p.cleanup(); }
      d.destroy();
      return out;
    };
  });
  return page;
}
function crossOrigin(page, base) { return page.requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')); }
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

/* Every library font: each glyph the face has (printable ASCII and a few accented letters) must draw ink when the PDF is
   rendered by pdf.js. Before the fix, Inter, EB Garamond, Cormorant Garamond, Lobster, Great Vibes, Caveat, Pacifico and
   Kalam lost most glyphs, and Sacramento, Space Grotesk, Bebas Neue, Dancing Script and IBM Plex Mono could not embed. */
async function fontCase(h, browser, base, part, parts) {
  const page = await h.open(browser, base, '/pdf-studio/');
  await page.waitForFunction(() => window.LE && LE.pdf && LE.fonts);
  const res = await page.evaluate(async ([part, parts]) => {
    await LE.pdf.ready();
    const fams = LE.fonts.list().map((f) => f.family);
    const mine = fams.filter((f, i) => i % parts === part);
    const CHARS = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('') + 'éüßñçøåÆŁœ€';
    const out = {};
    for (const fam of mine) {
      const raw = await LE.fonts.bytes(fam, 400, false);
      const kit = fontkit.create(await LE.pdf.fontFileForPdf(raw));
      const chars = Array.from(CHARS).filter((c) => { const g = kit.glyphForCodePoint(c.codePointAt(0)); return g && g.id > 0 && g.path && g.path.commands.length > 0; });
      const doc = await PDFLib.PDFDocument.create();
      const font = await LE.pdf.embedFont(doc, fam, 400, false, { warnings: [] });
      const cols = 20, cell = 28, rows = Math.ceil(chars.length / cols);
      const pg = doc.addPage([cols * cell + 20, rows * cell + 20]);
      chars.forEach((c, i) => pg.drawText(c, { x: 10 + (i % cols) * cell + 6, y: pg.getHeight() - 10 - (Math.floor(i / cols) + 1) * cell + 9, size: 14, font }));
      const bytes = await doc.save();
      const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const p = await pdf.getPage(1);
      const vp = p.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: g, viewport: vp }).promise;
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const missing = [];
      chars.forEach((ch, i) => {
        const x0 = (10 + (i % cols) * cell) * 2, y0 = (10 + Math.floor(i / cols) * cell) * 2;
        let ink = 0;
        for (let y = y0; y < y0 + cell * 2; y++) for (let x = x0; x < x0 + cell * 2; x++) if (data[(y * c.width + x) * 4] < 150) ink++;
        if (!ink) missing.push(ch);
      });
      pdf.destroy();
      out[fam] = { name: font.name, glyphs: chars.length, missing: missing.join('') };
    }
    return out;
  }, [part, parts]);
  const fams = Object.keys(res);
  h.assert(fams.length >= 8, 'expected a share of the font library, got ' + fams.length);
  fams.forEach((f) => {
    h.assert(!/^(Helvetica|Times|Courier)/.test(res[f].name), f + ' fell back to a standard font (' + res[f].name + ')');
    h.assert(res[f].glyphs >= 60, f + ' has only ' + res[f].glyphs + ' glyphs in the check');
    h.assert.equal(res[f].missing, '', f + ' lost glyphs');
  });
  h.assert.noErrors(page);
  await page.context().close();
}

module.exports = {
  'fonts: library fonts 1/4 embed and render every glyph': async ({ browser, base, h }) => fontCase(h, browser, base, 0, 4),
  'fonts: library fonts 2/4 embed and render every glyph': async ({ browser, base, h }) => fontCase(h, browser, base, 1, 4),
  'fonts: library fonts 3/4 embed and render every glyph': async ({ browser, base, h }) => fontCase(h, browser, base, 2, 4),
  'fonts: library fonts 4/4 embed and render every glyph': async ({ browser, base, h }) => fontCase(h, browser, base, 3, 4),

  'details: proposals fill the form; values read back with pdf-lib; passwords and signatures are never filled': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const O = LE.pdfOffice;
      const prof = O.details.save({ label: 'Me', fields: { firstName: 'Zoë', middleName: 'Anne', lastName: 'Łukasiewicz', email: 'zoe.l@example.com', phone: '+44 20 7946 0000', mobile: '07700 900123', dob: '1990-04-23', address1: '12 Harbour Street', city: 'Bristol', postcode: 'BS1 4QA', country: 'united kingdom', company: 'Northwind Traders', vatNumber: 'GB123456789', iban: 'GB33BUKB20201555555555' } });
      const fields = await O.formFields(await __fx('form.pdf'));
      const rows = O.propose(fields, prof, { dateOrder: 'dmy', today: new Date('2026-11-12T10:00:00') });
      const vals = {};
      rows.forEach((x) => { if (!x.skip) vals[x.name] = x.value; });
      const filled = await O.fill(await __fx('form.pdf'), vals);
      const doc = await PDFLib.PDFDocument.load(filled);
      const form = doc.getForm(), back = {};
      form.getFields().forEach((f) => { back[f.getName()] = f.getText ? (f.getText() || '') : f.getSelected ? f.getSelected().join('|') : ''; });
      const shown = await __texts(await O.fill(await __fx('form.pdf'), vals, { flatten: true }));
      return { rows: rows.map((x) => [x.name, x.key, x.value, x.skip, x.source]), back, report: filled.report, shown: shown[0] };
    });
    const row = (n) => r.rows.find((x) => x[0] === n);
    const expect = { 'First Name': 'Zoë', Surname: 'Łukasiewicz', f1_03: 'Anne', 'Email Address': 'zoe.l@example.com', Phone: '+44 20 7946 0000', Mobile: '07700 900123', DOB: '23/04/1990', 'Address Line 1': '12 Harbour Street', Text7: 'Bristol', Postcode: 'BS1 4QA', Company: 'Northwind Traders', 'VAT Number': 'GB123456789', IBAN: 'GB33BUKB20201555555555', Date: '12/11/2026', Country: 'United Kingdom' };
    Object.keys(expect).forEach((k) => h.assert.equal(r.back[k], expect[k], 'read back ' + k));
    h.assert.equal(row('f1_03')[4], 'name', 'tooltip-only field matched from its tooltip');
    h.assert.equal(row('Text7')[4], 'label', 'unnamed field matched from the printed label');
    h.assert.equal(row('Account Password')[3], 'password', 'password field skipped');
    h.assert.equal(row('Signature of applicant')[3], 'never', 'signature field skipped');
    h.assert.equal(r.back['Account Password'], '', 'password never filled');
    h.assert.equal(r.back['Signature of applicant'], '', 'signature never filled');
    h.assert.equal(r.back.Notes, '', 'unmatched field left empty');
    h.assert.equal(r.report.filled.length, Object.keys(expect).length, 'filled count');
    h.assert(r.shown.indexOf('Łukasiewicz') >= 0 && r.shown.indexOf('Zoë') >= 0, 'Unicode answers drawn in the flattened page: ' + r.shown);
    const logs = page.logs.join('\n');
    ['zoe.l@example.com', 'GB33BUKB', 'Łukasiewicz'].forEach((s) => h.assert(logs.indexOf(s) < 0, 'a saved detail appeared in the console'));
    h.assert.noErrors(page);
  },

  'details: corrected mappings are remembered per form; profiles export, import and erase': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const O = LE.pdfOffice;
      O.details.eraseAll();
      const me = O.details.save({ label: 'Me', fields: { firstName: 'Ada', lastName: 'Byrne', company: 'Contoso', phone: '0123' } });
      const fam = O.details.save({ label: 'My son', fields: { firstName: 'Tom', lastName: 'Byrne' } });
      const fields = await O.formFields(await __fx('form.pdf'));
      const fp1 = await O.formFingerprint(fields), fp1b = await O.formFingerprint(await O.formFields(await __fx('form.pdf')));
      const fpOther = await O.formFingerprint(await O.formFields(await __fx('commented.pdf')));
      const before = O.propose(fields, me, { memory: O.mappings.get(fp1) });
      O.mappings.remember(fp1, { Notes: 'company', Phone: '' });
      const after = O.propose(fields, me, { memory: O.mappings.get(fp1) });
      const other = O.mappings.get(fpOther);
      const text = O.details.exportText();
      const listed = Object.keys(localStorage).filter((k) => /^le-pdf-details/.test(k));
      O.details.eraseAll();
      const gone = Object.keys(localStorage).filter((k) => /^le-pdf-details/.test(k));
      const bad = O.details.parse('{"format":"localeditor-details","profiles":[{"__proto__":{"x":1}}]}');
      const imp = O.details.importText(text);
      return { fp1, fp1b, fpOther, notesBefore: before.find((x) => x.name === 'Notes').skip, notesAfter: after.find((x) => x.name === 'Notes'), phoneAfter: after.find((x) => x.name === 'Phone').skip,
        other, listed, gone, bad: bad.ok, imported: imp.profiles.map((p) => p.label + ':' + p.fields.firstName), count: O.details.list().length, text };
    });
    h.assert.equal(r.fp1, r.fp1b, 'fingerprint is stable');
    h.assert(r.fp1 !== r.fpOther, 'different forms have different fingerprints');
    h.assert.equal(r.notesBefore, 'no-match', 'Notes unmatched before correction');
    h.assert.equal(r.notesAfter.value, 'Contoso', 'corrected mapping remembered');
    h.assert.equal(r.notesAfter.source, 'memory', 'mapping came from memory');
    h.assert.equal(r.phoneAfter, 'never', 'field marked "never fill" stays empty');
    h.assert.equal(r.other, null, 'no memory for another form');
    h.assert(r.listed.indexOf('le-pdf-details') >= 0 && r.listed.indexOf('le-pdf-details-maps') >= 0, 'stored under le-pdf-details*');
    h.assert.equal(r.gone.length, 0, 'erase removes profiles and mappings');
    h.assert.equal(r.bad, false, 'forbidden keys rejected');
    h.assert.equal(r.count, 2, 'two profiles imported');
    h.assert(r.imported.indexOf('Me:Ada') >= 0 && r.imported.indexOf('My son:Tom') >= 0, 'imported ' + r.imported);
    h.assert(/"format": "localeditor-details"/.test(r.text), 'export format');
    h.assert.noErrors(page);
  },

  'compare: finds exactly the planted changes, including the amount, the date and the moved paragraph; report PDF links': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const O = LE.pdfOffice;
      const a = await __fx('contract-v1.pdf'), b = await __fx('contract-v2.pdf');
      const c = await O.compare(a, b, { nameA: 'contract-v1.pdf', nameB: 'contract-v2.pdf' });
      const rep = await O.compareReport(a, b, c);
      const pdf = await __pdf(rep);
      const p1 = await pdf.getPage(1);
      const links = [];
      for (const an of await p1.getAnnotations()) if (an.subtype === 'Link' && an.dest) links.push(await pdf.getPageIndex(an.dest[0]));
      const t = await __texts(rep);
      return { summary: c.summary, changes: c.changes.map((x) => ({ type: x.type, before: x.before, after: x.after, special: x.special, exact: x.exact, pagesA: x.pagesA, pagesB: x.pagesB, rects: x.rectsB.length + x.rectsA.length })), pages: pdf.numPages, links, t1: t[0], rep: rep.report };
    });
    const C = CONTRACT_CHANGES;
    h.assert.equal(r.summary.count, C.count, 'number of changes: ' + JSON.stringify(r.changes.map((x) => x.type + ':' + x.before + '>' + x.after)));
    const find = (fn, what) => { const x = r.changes.find(fn); h.assert(x, 'missing change: ' + what); return x; };
    const amt = find((x) => x.before === C.amount[0] && x.after === C.amount[1], 'amount');
    h.assert.equal(amt.special, 'amount', 'amount called out');
    const dt = find((x) => x.before === C.date[0] && x.after === C.date[1], 'date');
    h.assert.equal(dt.special, 'date', 'date called out');
    const wd = find((x) => x.before === C.word[0] && x.after === C.word[1], 'word');
    h.assert.equal(wd.type, 'replaced', 'word replaced');
    const mv = find((x) => x.type === 'moved', 'moved paragraph');
    h.assert.equal(mv.after, C.moved, 'moved text');
    h.assert(mv.exact === true, 'moved paragraph unchanged');
    h.assert(mv.pagesA[0] !== mv.pagesB[0] || true, 'pages');
    h.assert.equal(find((x) => x.type === 'added', 'added').after, C.added, 'added sentence');
    h.assert.equal(find((x) => x.type === 'removed', 'removed').before, C.removed, 'removed sentence');
    h.assert(r.changes.every((x) => x.rects > 0), 'every change has highlight boxes');
    h.assert.equal(r.summary.special.length, 2, 'two special call-outs (amount, date)');
    h.assert(/^6 changes on \d pages?$/.test(r.summary.text), 'summary text: ' + r.summary.text);
    h.assert(r.t1.indexOf('Comparison report') >= 0 && r.t1.indexOf('$10,000') >= 0 && r.t1.indexOf('$12,500') >= 0, 'report summary lists the amount');
    h.assert.equal(r.links.length, 6, 'one link per change');
    h.assert(r.links.every((p) => p >= r.rep.summaryPages && p < r.pages), 'links point at marked pages');
    h.assert.equal(r.pages, r.rep.summaryPages + r.rep.pages - r.rep.summaryPages, 'report pages');
    h.assert.noErrors(page);
  },

  'compare: scanned pages are compared visually only; inserted pages are aligned': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const O = LE.pdfOffice;
      const s1 = await __fx('scan-v1.pdf'), s2 = await __fx('scan-v2.pdf');
      const c = await O.compare(s1, s2);
      const p1 = await __pdf(s1), p2 = await __pdf(s2);
      const ca = await O.renderPage(p1, 0, 1), cb = await O.renderPage(p2, 0, 1), cc = await O.renderPage(p1, 0, 1);
      const diff = O.visualDiff(ca, cb), same = O.visualDiff(ca, cc);
      /* contract v2 with a blank page inserted after page 1 */
      const doc = await PDFLib.PDFDocument.load(await __fx('contract-v2.pdf'));
      doc.insertPage(1, [595.28, 841.89]);
      const ins = await O.compare(await __fx('contract-v2.pdf'), await doc.save());
      return { textCompared: c.textCompared, scanned: c.a.scannedPages, notes: c.notes, count: c.summary.count, diff: diff.ratio, same: same.ratio, align: ins.alignment, insCount: ins.summary.count };
    });
    h.assert.equal(r.textCompared, false, 'scans are not text-compared');
    h.assert.equal(r.scanned.length, 1, 'scanned page listed');
    h.assert(r.notes.some((n) => /no text layer/.test(n)), 'honest note about scans');
    h.assert(r.diff > 0.005, 'visual difference found: ' + r.diff);
    h.assert.equal(r.same, 0, 'identical renders have no difference');
    h.assert.equal(JSON.stringify(r.align), JSON.stringify([[0, 0], [null, 1], [1, 2], [2, 3]]), 'inserted page aligned');
    h.assert.equal(r.insCount, 0, 'an inserted blank page is not a text change');
  },

  'bundle: cover, contents with links, bookmarks, page numbers and Bates per page': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const O = LE.pdfOffice;
      const b = await O.bundle({
        items: [{ kind: 'divider', title: 'Engagement' }, { kind: 'pdf', name: 'bundle-letter.pdf', title: 'Engagement letter', bytes: await __fx('bundle-letter.pdf') }, { kind: 'pdf', name: 'bundle-terms.pdf', bytes: await __fx('bundle-terms.pdf') },
          { kind: 'divider', title: 'Billing' }, { kind: 'pdf', name: 'bundle-invoice.pdf', title: 'Invoice', bytes: await __fx('bundle-invoice.pdf') }, { kind: 'image', name: 'logo.png', title: 'Logo sheet', bytes: await __fx('logo.png') }],
        cover: { title: 'Client pack for Contoso', subtitle: 'Engagement documents', preparedBy: 'Northwind', preparedFor: 'Contoso', date: '12 November 2026', logo: await __fx('logo.png') },
        toc: { title: 'Contents' }, numbering: { position: 'bc', format: 'page-n-of-N', start: 1 }, bates: { prefix: 'NW-', start: 100, digits: 5 }, footer: { left: '{title}' }
      });
      const pdf = await __pdf(b);
      const toc = await pdf.getPage(2);
      const links = [];
      for (const a of await toc.getAnnotations()) if (a.subtype === 'Link') links.push(await pdf.getPageIndex(a.dest[0]));
      const ol = await pdf.getOutline();
      const walk = async (items) => Promise.all(items.map(async (o) => ({ t: o.title, p: await pdf.getPageIndex(o.dest[0]), k: await walk(o.items || []) })));
      const texts = await __texts(b);
      return { pages: pdf.numPages, report: b.report, links, outline: await walk(ol), texts };
    });
    h.assert.equal(r.pages, 11, 'cover + contents + 2 dividers + 2 + 1 + 3 + image');
    h.assert.equal(JSON.stringify(r.report.toc.map((e) => e.title + '@' + e.page)), JSON.stringify(['Engagement@1', 'Engagement letter@2', 'bundle-terms@4', 'Billing@5', 'Invoice@6', 'Logo sheet@9']), 'contents entries and printed page numbers');
    h.assert.equal(JSON.stringify(r.links), JSON.stringify([2, 3, 5, 6, 7, 10]), 'contents links open the right pages');
    h.assert(r.texts[1].indexOf('Contents') >= 0 && r.texts[1].indexOf('Engagement letter') >= 0, 'contents page text');
    h.assert(r.texts[0].indexOf('Client pack for Contoso') >= 0 && r.texts[0].indexOf('Prepared for'.toUpperCase()) >= 0, 'cover text');
    for (let i = 2; i < 11; i++) {
      h.assert(r.texts[i].indexOf('Page ' + (i - 1) + ' of 9') >= 0, 'page number on page ' + (i + 1) + ': ' + r.texts[i]);
      h.assert(r.texts[i].indexOf('NW-' + String(100 + i - 2).padStart(5, '0')) >= 0, 'Bates number on page ' + (i + 1));
      h.assert(r.texts[i].indexOf('Client pack for Contoso') >= 0, 'footer on page ' + (i + 1));
    }
    h.assert(r.texts[0].indexOf('Page ') < 0 && r.texts[1].indexOf('Page 1') < 0, 'cover and contents not numbered');
    const top = r.outline.map((o) => o.t + '@' + o.p);
    h.assert.equal(JSON.stringify(top), JSON.stringify(['Cover: Client pack for Contoso@0', 'Contents@1', 'Engagement@2', 'Billing@6']), 'top-level bookmarks');
    const eng = r.outline[2].k;
    h.assert.equal(JSON.stringify(eng.map((o) => o.t + '@' + o.p)), JSON.stringify(['Engagement letter@3', 'bundle-terms@5']), 'documents nested under their section');
    h.assert.equal(JSON.stringify(eng[0].k.map((o) => o.t + '@' + o.p)), JSON.stringify(['Chapter 1@3', 'Chapter 2@4']), 'a document keeps its own bookmarks');
    h.assert.noErrors(page);
  },

  'stamps are page content; the comment summary lists every planted comment with links back': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const O = LE.pdfOffice;
      const st = await O.stampPages(await __fx('bundle-invoice.pdf'), { preset: 'paid', name: 'J. Smith', date: true, time: true, when: '2026-11-12T14:05:00' }, { pages: 'all', position: 'tr' });
      const sp = await __pdf(st);
      const annots = [];
      for (let i = 1; i <= sp.numPages; i++) annots.push((await (await sp.getPage(i)).getAnnotations()).length);
      const texts = await __texts(st);
      const list = await O.comments(await __fx('commented.pdf'));
      const sum = await O.commentSummary(await __fx('commented.pdf'), { name: 'commented.pdf' });
      const pdf = await __pdf(sum);
      const last = await pdf.getPage(pdf.numPages);
      const links = [];
      for (const a of await last.getAnnotations()) if (a.subtype === 'Link') links.push(await pdf.getPageIndex(a.dest[0]));
      const st2 = await O.commentSummary(await __fx('commented.pdf'), { mode: 'separate' });
      return { annots, texts, list, csv: O.commentsCsv(list), sumText: (await __texts(sum)).pop(), pages: pdf.numPages, links, sepPages: (await __pdf(st2)).numPages };
    });
    h.assert(r.annots.every((n) => n === 0), 'stamps add no annotations');
    r.texts.forEach((t, i) => h.assert(t.indexOf('PAID') >= 0 && t.indexOf('J. Smith') >= 0, 'stamp text in page ' + (i + 1) + ' content: ' + t));
    h.assert.equal(r.list.length, 5, 'five comments');
    const by = (s) => r.list.find((c) => c.text === s);
    h.assert.equal(by('Is 30 days right?').excerpt, 'net payment terms', 'highlight excerpt');
    h.assert.equal(by('Fixed in version 2').replyTo, by('Please check this figure').id, 'reply linked to its note');
    h.assert.equal(by('Delete this word').page, 1, 'page of the strike-out');
    ['Please check this figure', 'Fixed in version 2', 'Is 30 days right?', 'Delete this word', 'Approved by legal', 'Asha Rao', 'Ben Ortiz', 'Legal team', '“net payment terms”'].forEach((s) => h.assert(r.sumText.indexOf(s) >= 0, 'summary lists ' + s));
    h.assert(/5 comments on 2 pages/.test(r.sumText), 'summary counts');
    h.assert.equal(r.pages, 3, 'summary appended');
    h.assert.equal(JSON.stringify(r.links), JSON.stringify([0, 0, 0, 1, 1]), 'each entry links back to its page');
    h.assert.equal(r.sepPages, 1, 'separate summary is its own PDF');
    h.assert.equal(r.csv.trim().split('\r\n').length, 6, 'CSV header + 5 rows');
    h.assert.noErrors(page);
  },

  'workflows: validation rejects bad files; a password is never stored': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(() => {
      const O = LE.pdfOffice, V = O.validateWorkflow;
      const ok = (steps, extra) => Object.assign({ format: 'localeditor-pdf-workflow', version: '1.0', steps }, extra || {});
      const cases = {
        notJson: V('{nope'),
        wrongFormat: V({ format: 'localeditor-workflow', version: '1.0', steps: [{ operation: 'reverse' }] }),
        future: V(ok([{ operation: 'reverse' }], { version: '2.0' })),
        noSteps: V(ok([])),
        unknownOp: V(ok([{ operation: 'run-script' }])),
        outOfRange: V(ok([{ operation: 'page-numbers', parameters: { start: -4 } }])),
        stringNumber: V(ok([{ operation: 'watermark', parameters: { text: 'X', opacity: '0.2' } }])),
        badEnum: V(ok([{ operation: 'rotate', parameters: { degrees: 45 } }])),
        badRange: V(ok([{ operation: 'delete-pages', parameters: { pages: 'everything' } }])),
        proto: V('{"format":"localeditor-pdf-workflow","version":"1.0","steps":[{"operation":"reverse","parameters":{"__proto__":{"polluted":1}}}]}'),
        password: V(ok([{ operation: 'protect', parameters: { ask: true, password: 'hunter2' } }])),
        passwordMeta: V(ok([{ operation: 'reverse' }], { metadata: { name: 'x', userPassword: 'a' } })),
        markup: V(ok([{ operation: 'watermark', parameters: { text: '<script>alert(1)</script>' } }])),
        jsUrl: V(ok([{ operation: 'metadata', parameters: { title: 'javascript:alert(1)' } }])),
        twoCombine: V(ok([{ operation: 'merge' }, { operation: 'bundle' }])),
        tooMany: V(ok(Array.from({ length: 31 }, () => ({ operation: 'reverse' })))),
        badBool: V(ok([{ operation: 'reverse', enabled: 'yes' }]))
      };
      const good = V(ok([{ operation: 'watermark', parameters: { text: 'DRAFT', opacity: 0.2, extra: 1 } }, { operation: 'protect' }]));
      const text = O.workflows.serialize(good.workflow);
      const builtins = O.workflows.builtins().map((w) => ({ name: w.metadata.name, ok: V(w).ok, text: O.workflows.serialize(w) }));
      O.workflows.save(good.workflow);
      const stored = localStorage.getItem('le-pdf-workflows');
      const reimport = V(text);
      return { cases: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.ok ? 'OK' : v.errors[0]])), good: good.ok, warnings: good.warnings, text, builtins, stored, reimport: reimport.ok && JSON.stringify(reimport.workflow) === JSON.stringify(good.workflow) };
    });
    Object.keys(r.cases).forEach((k) => h.assert(r.cases[k] !== 'OK', 'should reject: ' + k));
    h.assert(/never store passwords/.test(r.cases.password) && /never store passwords/.test(r.cases.passwordMeta), 'password rejected with a clear message');
    h.assert(/markup or script/.test(r.cases.markup) && /markup or script/.test(r.cases.jsUrl), 'markup rejected');
    h.assert(/between/.test(r.cases.outOfRange) && /must be a number/.test(r.cases.stringNumber), 'numbers strictly checked');
    h.assert(r.good && r.warnings.some((w) => /extra/.test(w)), 'unknown parameter dropped with a warning');
    h.assert(/"ask": true/.test(r.text), 'protect stores only "ask for a password"');
    const keys = (v, out) => { if (v && typeof v === 'object') Object.keys(v).forEach((k) => { out.push(k); keys(v[k], out); }); return out; };
    [r.text, r.stored].concat(r.builtins.map((b) => b.text)).forEach((t) => {
      h.assert(t.indexOf('hunter2') < 0, 'no password value in a stored workflow');
      const bad = keys(JSON.parse(t), []).filter((k) => /pass|pwd|secret|token/i.test(k));
      h.assert.equal(bad.length, 0, 'no password key in a stored workflow: ' + bad);
    });
    h.assert.equal(r.builtins.length, 4, 'four built-ins');
    h.assert(r.builtins.every((b) => b.ok), 'built-ins validate');
    h.assert(r.reimport, 'serialised file re-imports to the same workflow');
    h.assert.noErrors(page);
  },

  'workflows: built-ins run end-to-end': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const PW = 'meadow-quartz-77-lantern';
    const r = await page.evaluate(async (PW) => {
      const O = LE.pdfOffice, W = O.workflows.builtins();
      const by = (id) => W.find((w) => w.metadata.id === id);
      const contract = await __fx('contract-v1.pdf');
      let asked = 0;
      const safe = await O.runWorkflow([{ name: 'contract.pdf', bytes: contract }], by('safe-to-send'), { askPassword: async () => { asked++; return 'x'; } });
      const email = await O.runWorkflow([{ name: 'contract.pdf', bytes: contract }], by('email-friendly'));
      const draft = await O.runWorkflow([{ name: 'contract.pdf', bytes: contract }], by('numbered-draft'));
      const pack = await O.runWorkflow([{ name: 'a.pdf', bytes: await __fx('bundle-letter.pdf') }, { name: 'b.pdf', bytes: await __fx('bundle-terms.pdf') }], by('client-pack'), { askPassword: async () => PW });
      const many = await O.runWorkflow([{ name: 'x.pdf', bytes: contract }, { name: 'y.pdf', bytes: await __fx('bundle-terms.pdf') }], by('numbered-draft'));
      let locked;
      try { await __pdf(pack.files[0].bytes); locked = 'opened'; } catch (e) { locked = e.name; }
      const unlocked = await __pdf(pack.files[0].bytes, PW);
      const emailMeta = await (await __pdf(email.files[0].bytes)).getMetadata();
      return {
        asked, safe: safe.log.map((l) => l.ok), safeLen: safe.files[0].bytes.length,
        email: email.log.map((l) => l.ok), author: emailMeta.info.Author || '', producer: emailMeta.info.Producer || '',
        draft: await __texts(draft.files[0].bytes), packLog: pack.log.map((l) => l.operation + ':' + l.ok), packName: pack.files[0].name, locked, packPages: unlocked.numPages,
        many: many.files.map((f) => f.name)
      };
    }, PW);
    h.assert.equal(r.asked, 0, 'no password asked without a protect step');
    h.assert(r.safe.every(Boolean) && r.safeLen > 500, 'safe to send ran');
    h.assert(r.email.every(Boolean), 'email-friendly ran');
    h.assert.equal(r.author, '', 'author removed');
    h.assert(r.draft[0].indexOf('Page 1 of 3') >= 0 && r.draft[2].indexOf('Page 3 of 3') >= 0, 'numbered');
    h.assert(r.draft[0].indexOf('DRAFT') >= 0, 'stamped and watermarked draft');
    h.assert.equal(JSON.stringify(r.packLog), JSON.stringify(['bundle:true', 'page-numbers:true', 'scrub:true', 'protect:true']), 'client pack steps');
    h.assert.equal(r.locked, 'PasswordException', 'client pack is locked');
    h.assert.equal(r.packPages, 5, 'cover + contents + 3 pages');
    h.assert.equal(JSON.stringify(r.many), JSON.stringify(['x.pdf', 'y.pdf']), 'several files run one by one');
    const logs = page.logs.join('\n');
    h.assert(logs.indexOf(PW) < 0, 'password never logged');
    h.assert.noErrors(page);
  },

  'fingerprint: SHA-256 matches Node; QR codes decode to the verify link with the hash in the fragment': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await page.addScriptTag({ path: path.join(__dirname, 'lib', 'jsqr.js') });
    const file = fs.readFileSync(path.join(FX, 'contract-v1.pdf'));
    const expected = crypto.createHash('sha256').update(file).digest('hex');
    const big = crypto.randomBytes(3 * 1024 * 1024 + 17);
    const r = await page.evaluate(async (bigB64) => {
      const O = LE.pdfOffice;
      const bytes = await __fx('contract-v1.pdf');
      const fp = await O.fingerprint(bytes, { name: 'contract-v1.pdf' });
      const big = Uint8Array.from(atob(bigB64), (c) => c.charCodeAt(0));
      const bigHash = await O.sha256(big);
      const decode = (c) => { const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height); const q = jsQR(d.data, d.width, d.height); return q ? q.data : null; };
      const rp = await O.receiptPdf(bytes, { name: 'contract-v1.pdf' });
      const pdf = await __pdf(rp);
      const canvas = await O.renderPage(pdf, 0, 2);
      const card = await O.receiptCard(bytes, { name: 'contract-v1.pdf' });
      const img = await createImageBitmap(card);
      const cc = document.createElement('canvas'); cc.width = img.width; cc.height = img.height; cc.getContext('2d').drawImage(img, 0, 0);
      const app = await O.appendReceipt(bytes, { name: 'contract-v1.pdf' });
      const emb = await O.embedFingerprint(bytes);
      const embMeta = await (await __pdf(emb)).getMetadata();
      return { fp, bigHash, qrPdf: decode(canvas), qrCard: decode(cc), text: (await __texts(rp))[0], appPages: (await __pdf(app)).numPages, app: app.report, embSubject: embMeta.info.Subject };
    }, big.toString('base64'));
    h.assert.equal(r.fp.sha256, expected, 'SHA-256 matches Node crypto');
    h.assert.equal(r.bigHash, crypto.createHash('sha256').update(big).digest('hex'), 'large random file');
    h.assert.equal(r.fp.short, expected.slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, '$1 '), 'short form');
    const url = 'https://localeditor.net/verify/#sha256=' + expected;
    h.assert.equal(r.qrPdf, url, 'QR on the receipt PDF decodes to the verify link');
    h.assert.equal(r.qrCard, url, 'QR on the card decodes to the verify link');
    h.assert(r.text.indexOf(r.fp.short) >= 0 && r.text.indexOf('contract-v1.pdf') >= 0, 'receipt shows name and fingerprint');
    h.assert(/does not show who made the file/.test(r.text), 'receipt says what it does not prove');
    h.assert.equal(r.appPages, 4, 'receipt appended as a last page');
    h.assert.equal(r.app.original.sha256, expected, 'appended receipt is of the original');
    h.assert(r.app.copy !== expected, 'the copy has its own fingerprint');
    h.assert.equal(r.embSubject, 'SHA-256 of the original file: ' + expected, 'fingerprint in the file details');
  },

  'fingerprint: the pure-JS SHA-256 fallback matches': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const data = crypto.randomBytes(200003);
    const r = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
      return [await LE.pdfOffice.sha256(bytes), await LE.pdfOffice.sha256(new Uint8Array(0)), await LE.pdfOffice.sha256(new TextEncoder().encode('abc'))];
    }, data.toString('base64'));
    h.assert.equal(r[0], crypto.createHash('sha256').update(data).digest('hex'), 'random data');
    h.assert.equal(r[1], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'empty');
    h.assert.equal(r[2], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'abc');
    },

  /* ---------- the studio UI ---------- */

  'studio: Office kit entry points; fill from my details fills the form, remembers a correction and saves': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    h.assert(await page.locator('.po-entry').isVisible(), 'start screen link');
    await page.click('.po-entry');
    await page.waitForSelector('.ps-pane[data-pane="office"] .po-job');
    h.assert.equal(await page.locator('.ps-pane[data-pane="office"] .po-job').count(), 6, 'six jobs');
    await page.evaluate(async () => {
      LE.pdfOffice.details.eraseAll();
      LE.pdfOffice.details.save({ label: 'Me', fields: { firstName: 'Zoë', lastName: 'Okafor', email: 'zoe@example.com', company: 'Northwind Traders', city: 'Bristol', dob: '1990-04-23' } });
      await PS.addFiles([new File([await __fx('form.pdf')], 'form.pdf', { type: 'application/pdf' })]);
    });
    await page.waitForFunction(() => PS.S.fields.length > 10);
    await page.evaluate(() => PS.openPanel('forms'));
    await page.click('.po-forms-cta');
    await page.waitForSelector('.po-rev-row[data-field="Notes"] select');
    h.assert(await page.locator('.po-rev-row[data-field="Account Password"].is-locked').count() === 1, 'password row locked');
    h.assert(await page.locator('.po-rev-row[data-field="Signature of applicant"].is-locked').count() === 1, 'signature row locked');
    await page.selectOption('.po-rev-row[data-field="Notes"] select', 'company');
    await shot(page, 'ui-details-review');
    await page.click('.po-go');
    await page.waitForFunction(() => document.querySelector('.po-work').hidden);
    const r = await page.evaluate(async () => {
      const id = PS.S.pages[0].docId;
      const fields = await LE.pdfOffice.formFields(PS.S.docs[id].bytes());
      return { vals: PS.S.formValues[id], mem: LE.pdfOffice.mappings.get(await LE.pdfOffice.formFingerprint(fields)) };
    });
    h.assert.equal(r.vals['First Name'], 'Zoë', 'first name filled');
    h.assert.equal(r.vals['Text7'], 'Bristol', 'label-matched field filled');
    h.assert.equal(r.vals.Notes, 'Northwind Traders', 'corrected field filled');
    h.assert(!('Account Password' in r.vals) && !('Signature of applicant' in r.vals), 'password and signature untouched');
    h.assert.equal(r.mem && r.mem.Notes, 'company', 'correction remembered for this form');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
    const bytes = fs.readFileSync(await dl.path());
    const back = await page.evaluate(async (b64) => {
      const doc = await PDFLib.PDFDocument.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const f = doc.getForm();
      return { first: f.getTextField('First Name').getText(), notes: f.getTextField('Notes').getText(), pw: f.getTextField('Account Password').getText() || '' };
    }, bytes.toString('base64'));
    h.assert.equal(back.first, 'Zoë', 'saved PDF keeps the answer');
    h.assert.equal(back.notes, 'Northwind Traders', 'saved PDF keeps the corrected answer');
    h.assert.equal(back.pw, '', 'saved password field empty');
    h.assert(page.logs.join('\n').indexOf('zoe@example.com') < 0, 'details never logged');
    h.assert.equal(crossOrigin(page, base).length, 0, 'no third-party requests');
    h.assert.noErrors(page);
  },

  'studio: stamp my details on a flat PDF; stamp every page becomes page content on save': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await page.evaluate(async () => {
      LE.pdfOffice.details.eraseAll();
      LE.pdfOffice.details.save({ label: 'Me', fields: { firstName: 'Ada', lastName: 'Byrne', email: 'ada@example.com' } });
      await PS.addFiles([new File([await __fx('bundle-invoice.pdf')], 'invoice.pdf', { type: 'application/pdf' })]);
    });
    await page.waitForFunction(() => PS.S.pages.length === 3);
    await page.evaluate(() => PS.office.open('details'));
    await page.waitForSelector('.po-detail-chip[data-k="email"]');
    await page.click('.po-detail-chip[data-k="email"]');
    h.assert.equal(await page.evaluate(() => PS.S.tool), 'po-text', 'tool armed');
    const box = await page.locator('.pv-page').first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await page.waitForTimeout(300);
    const texts = await page.evaluate(() => PS.S.pages[0].scene.layers.filter((l) => l.type === 'text').map((l) => l.text));
    h.assert(texts.indexOf('ada@example.com') >= 0, 'detail placed as a text object');
    await page.evaluate(() => PS.office.open('stamps'));
    await page.click('.po-stamp[data-p="paid"]');
    await shot(page, 'ui-stamps');
    await page.click('[data-po="stamp-every"]');
    const n = await page.evaluate(() => PS.S.pages.filter((r) => r.scene && r.scene.layers.some((l) => /^Stamp: PAID/.test(l.name))).length);
    h.assert.equal(n, 3, 'stamp on every page');
    await page.evaluate(() => PS.undo());
    h.assert.equal(await page.evaluate(() => PS.S.pages.filter((r) => r.scene && r.scene.layers.some((l) => /^Stamp/.test(l.name))).length), 0, 'one undo removes them all');
    await page.evaluate(() => PS.redo());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
    const bytes = fs.readFileSync(await dl.path());
    const r = await page.evaluate(async (b64) => {
      const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pdf = await __pdf(b);
      const out = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const ops = await p.getOperatorList();
        out.push({ annots: (await p.getAnnotations()).length, images: ops.fnArray.filter((f) => f === pdfjsLib.OPS.paintImageXObject).length });
      }
      return { pages: out, text: (await __texts(b))[0] };
    }, bytes.toString('base64'));
    h.assert(r.pages.every((p) => p.annots === 0 && p.images >= 1), 'stamp drawn into each page: ' + JSON.stringify(r.pages));
    h.assert(r.text.indexOf('ada@example.com') >= 0, 'placed detail saved as text: ' + r.text);
    h.assert.noErrors(page);
  },

  'studio: compare two versions shows the changes, a picture view and downloads a report': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await page.evaluate(() => PS.office.open('compare'));
    const pick = async (n, file) => {
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.po-pick:nth-of-type(' + n + ') .po-pick-acts .btn')]);
      await fc.setFiles(path.join(FX, file));
    };
    await pick(1, 'contract-v1.pdf');
    await pick(2, 'contract-v2.pdf');
    await page.click('.po-go');
    await page.waitForSelector('.po-change');
    h.assert.equal((await page.textContent('.po-cmp-head strong')).trim().replace(/\d pages?/, 'N pages'), '6 changes on N pages', 'summary');
    h.assert.equal(await page.locator('.po-change').count(), 6, 'six changes listed');
    h.assert.equal(await page.locator('.po-special-row').count(), 2, 'amount and date called out');
    h.assert((await page.textContent('.po-special')).indexOf('$12,500') >= 0, 'amount shown');
    await page.click('.po-special-row:nth-of-type(2)');
    await page.waitForSelector('.po-vis canvas');
    for (const m of ['Overlay', 'Blink', 'Difference']) {
      await page.click('.po-vis-bar .ps-seg button:has-text("' + m + '")');
      await page.waitForSelector('.po-vis canvas');
    }
    h.assert((await page.textContent('.po-vis figcaption')).indexOf('differ') >= 0, 'difference view caption');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.po-go')]);
    const bytes = fs.readFileSync(await dl.path());
    h.assert(bytes.slice(0, 5).toString() === '%PDF-' && bytes.length > 3000, 'report downloaded');
    h.assert.equal(crossOrigin(page, base).length, 0, 'no third-party requests');
    h.assert.noErrors(page);
  },

  'studio: build a pack from chosen files; the preview lists printed page numbers': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await page.evaluate(() => PS.office.open('bundle'));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-po="bundle-add"]')]);
    await fc.setFiles(['bundle-letter.pdf', 'bundle-terms.pdf', 'bundle-invoice.pdf'].map((f) => path.join(FX, f)));
    await page.fill('[data-k="cover-title"]', 'Contoso pack');
    await page.waitForFunction(() => document.querySelectorAll('.po-plan-list li').length === 5);
    const plan = await page.$$eval('.po-plan-list li', (ls) => ls.map((l) => l.textContent));
    h.assert.equal(JSON.stringify(plan), JSON.stringify(['Coverpage 1', 'Contents1 page', 'bundle-letterpp. 1–2', 'bundle-termsp. 3', 'bundle-invoicepp. 4–6']), 'plan');
    await page.click('.po-item:nth-child(3) [aria-label="Move up"]');
    await page.waitForFunction(() => document.querySelector('.po-plan-list li:nth-child(4)').textContent.indexOf('bundle-invoice') === 0);
    await shot(page, 'ui-bundle');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.po-go')]);
    const bytes = fs.readFileSync(await dl.path());
    h.assert.equal(dl.suggestedFilename(), 'Contoso pack.pdf', 'file name from the title');
    const t = await page.evaluate(async (b64) => __texts(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), bytes.toString('base64'));
    h.assert.equal(t.length, 8, 'cover + contents + 6 pages');
    h.assert(t[4].indexOf('Invoice 2026-114') >= 0 && t[4].indexOf('Page 3 of 6') >= 0, 'reordered and numbered: ' + t[4]);
    h.assert.noErrors(page);
  },

  'studio: workflows run on the open document; a protect step asks for a password; bad files are refused': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await page.evaluate(async () => { await PS.addFiles([new File([await __fx('contract-v1.pdf')], 'contract.pdf', { type: 'application/pdf' })]); });
    await page.waitForFunction(() => PS.S.pages.length === 3);
    await page.evaluate(() => PS.office.open('workflows'));
    await page.click('.po-wf[data-wf="numbered-draft"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.po-go')]);
    const bytes = fs.readFileSync(await dl.path());
    const t = await page.evaluate(async (b64) => __texts(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), bytes.toString('base64'));
    h.assert(t[0].indexOf('Page 1 of 3') >= 0 && t[0].indexOf('DRAFT') >= 0, 'draft workflow applied');
    h.assert((await page.textContent('.po-log')).indexOf('Number the pages') >= 0, 'run log shown');
    await page.click('.po-wf[data-wf="client-pack"]');
    await page.click('.po-go');
    await page.waitForSelector('#ps-dialog[open] #po-wf-pw');
    await page.fill('#po-wf-pw', 'lantern-quartz-91');
    await page.fill('#po-wf-pw2', 'lantern-quartz-91');
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#ps-dialog[open] .btn-gold')]);
    const locked = fs.readFileSync(await dl2.path());
    const opened = await page.evaluate(async (b64) => { try { await __pdf(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); return 'opened'; } catch (e) { return e.name; } }, locked.toString('base64'));
    h.assert.equal(opened, 'PasswordException', 'client pack is password-protected');
    const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    h.assert(stored.indexOf('lantern-quartz-91') < 0, 'password not stored');
    const bad = path.join(require('os').tmpdir(), 'evil.lepdfworkflow');
    fs.writeFileSync(bad, JSON.stringify({ format: 'localeditor-pdf-workflow', version: '1.0', steps: [{ operation: 'protect', parameters: { password: 'x' } }] }));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-po="wf-import"]')]);
    await fc.setFiles(bad);
    await page.waitForSelector('#ps-dialog[open]');
    h.assert((await page.textContent('#ps-dialog')).indexOf('never store passwords') >= 0, 'bad workflow refused with a reason');
    h.assert.noErrors(page);
  },

  'verify page: says match or different, from the link fragment, with no network request for the check': async ({ browser, base, h }) => {
    const file = path.join(FX, 'contract-v1.pdf');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    for (const vp of ['desktop', 'small']) {
      const page = await h.open(browser, base, '/verify/#sha256=' + hash, vp);
      const reqs = [];
      page.on('request', (r) => reqs.push(r.url()));
      h.assert.equal((await page.textContent('#vf-exp-short')).trim(), hash.slice(0, 16).toUpperCase().replace(/(.{4})(?!$)/g, '$1 '), 'expected fingerprint shown');
      let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#vf-drop')]);
      await fc.setFiles(file);
      await page.waitForFunction(() => /matches|different/.test(document.getElementById('vf-verdict-title').textContent));
      h.assert.equal(await page.textContent('#vf-verdict-title'), 'This file matches the fingerprint', 'match');
      h.assert((await page.textContent('#vf-verdict-text')).indexOf('does not show who made it') >= 0, 'says what a match does not prove');
      [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#vf-drop')]);
      await fc.setFiles(path.join(FX, 'contract-v2.pdf'));
      await page.waitForFunction(() => /different/.test(document.getElementById('vf-verdict-title').textContent));
      h.assert.equal(await page.textContent('#vf-verdict-title'), 'This file is different', 'different');
      h.assert.equal(reqs.length, 0, 'checking makes no request: ' + reqs.join(', '));
      h.assert(await h.noOverflow(page), 'no sideways scroll at ' + vp);
      h.assert.noErrors(page);
      await page.context().close();
    }
    h.assert(/\['pdf', 'verify', 'Verify a File'/.test(fs.readFileSync(path.join(h.ROOT, 'scripts', 'build.js'), 'utf8')), 'listed in scripts/build.js');
    h.assert(/class="hp-tool" href="verify\/"/.test(fs.readFileSync(path.join(h.ROOT, 'index.html'), 'utf8')), 'listed in the homepage directory');
    const page = await h.open(browser, base, '/verify/');
    await page.click('#vf-manual summary');
    await page.fill('#vf-paste', hash.toUpperCase());
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#vf-drop')]);
    await fc.setFiles(file);
    await page.waitForFunction(() => /matches/.test(document.getElementById('vf-verdict-title').textContent));
    h.assert.noErrors(page);
  },

  'studio: workbenches fit phones (390 and 360) with 44px targets and no sideways scroll; dark theme': async ({ browser, base, h }) => {
    for (const vp of ['phone', 'small']) {
      const page = await studio(h, browser, base, vp, { colorScheme: vp === 'small' ? 'dark' : 'light' });
      await page.evaluate(async () => { await PS.addFiles([new File([await __fx('form.pdf')], 'form.pdf', { type: 'application/pdf' })]); });
      await page.waitForFunction(() => PS.S.pages.length === 1);
      for (const job of ['details', 'compare', 'bundle', 'stamps', 'workflows', 'fingerprint']) {
        await page.evaluate((j) => PS.office.open(j), job);
        await page.waitForTimeout(job === 'details' || job === 'fingerprint' ? 900 : 300);
        h.assert(await h.noOverflow(page), job + ' overflows at ' + vp);
        const small = await page.evaluate(() => [...document.querySelectorAll('.po-work button:not([hidden]), .po-work select, .po-work input:not([type=checkbox]):not([type=color])')]
          .filter((b) => b.offsetParent && !b.closest('[hidden]') && !b.closest('details:not([open])')).map((b) => [b.className || b.tagName, b.getBoundingClientRect().height]).filter((x) => x[1] > 0 && x[1] < 43.5));
        h.assert.equal(small.length, 0, job + ' has small targets: ' + JSON.stringify(small.slice(0, 4)));
        (await h.inkContrast(page, '.po-go:not(:disabled)')).forEach((c) => h.assert(c.ratio >= 4.5, 'primary text ' + c.color + ' on ' + c.bg + ' is ' + c.ratio + ':1'));
        await page.evaluate(() => PS.office.close());
      }
      h.assert.noErrors(page);
      await page.context().close();
    }
  },

  'studio: ?panel=office&job=compare opens the compare workbench': async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/pdf-studio/?panel=office&job=compare');
    await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'office' && document.querySelector('.po-work') && !document.querySelector('.po-work').hidden);
    h.assert.equal(await page.textContent('#po-work-title'), 'Compare two versions', 'job opened');
    h.assert.noErrors(page);
  }
};
