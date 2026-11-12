/* PDF security suite (D1-D4, D6): LE.pdfSecurity on planted fixtures, hostile inputs, and the Protect panel. */
'use strict';

async function secPage(h, browser, base, viewport, opts) {
  const page = await h.open(browser, base, '/pdf-studio/', viewport || 'desktop', opts);
  await page.addScriptTag({ url: base + '/tests/fixtures/pdf-security/fixtures.js' });
  await page.evaluate(() => LE.pdf.ready());
  return page;
}

async function studioWith(h, browser, base, viewport, fixture) {
  const page = await secPage(h, browser, base, viewport);
  await page.evaluate(async (fx) => {
    const b = await SecFixtures[fx]();
    await PS.addFiles([new File([b], fx + '.pdf', { type: 'application/pdf' })]);
  }, fixture);
  await page.waitForFunction(() => PS.S.pages.length > 0);
  await page.evaluate(() => PS.openPanel('security'));
  await page.waitForSelector('.sec-pane .sec-entry');
  return page;
}

const REVEAL_MARKERS = {
  info: ['TITLE-SECRET-INDIA', 'AUTHOR-SECRET-JULIET', 'SUBJECT-SECRET', 'KEYWORD-SECRET', 'Microsoft Word for Office 365', 'PRODUCER-SECRET', '2024-03-14', '2024-06-02'],
  xmp: ['XMP-CREATOR-KILO', 'XMP-DOCID-LIMA', 'XMP-TOOL'],
  id: ['DEADBEEF00112233'],
  attachments: ['payroll-2024.csv'],
  forms: ['FORM-VALUE-SIERRA', 'HIDDEN-FIELD-TANGO', 'hidden field'],
  comments: ['COMMENT-TEXT-OSCAR', 'COMMENT-AUTHOR-NOVEMBER', 'HIGHLIGHT-NOTE-QUEBEC', 'Reviewer PAPA'],
  hiddenText: ['INVISIBLE-SECRET-ALPHA', 'WHITE-SECRET-BRAVO', 'TINY-SECRET-CHARLIE', 'OFFPAGE-SECRET-DELTA', 'UNDER-IMAGE-ECHO', 'FAKE-BLACKOUT-ZETA', 'Covered by a shape'],
  layers: ['LAYER-NAME', 'LAYER-SECRET-FOXTROT', 'switched off'],
  links: ['LINK-SECRET-ROMEO'],
  thumbnails: ['Page 1'],
  imageMeta: ['EXIF-ARTIST-HOTEL', 'SecretCam', 'Location (GPS)', 'own XML details'],
  appData: ['private app data']
};
/* Strings that must be gone from every byte of a scrubbed file (after unpacking streams). */
const GONE = ['TITLE-SECRET-INDIA', 'AUTHOR-SECRET-JULIET', 'PRODUCER-SECRET', 'XMP-CREATOR-KILO', 'XMP-DOCID-LIMA', 'INVISIBLE-SECRET-ALPHA', 'WHITE-SECRET-BRAVO',
  'TINY-SECRET-CHARLIE', 'OFFPAGE-SECRET-DELTA', 'UNDER-IMAGE-ECHO', 'FAKE-BLACKOUT-ZETA', 'LAYER-SECRET-FOXTROT', 'LAYER-NAME', 'IMAGE-XMP-MIKE', 'COMMENT-AUTHOR-NOVEMBER', 'COMMENT-TEXT-OSCAR',
  'HIGHLIGHT-NOTE-QUEBEC', 'Reviewer PAPA', 'LINK-SECRET-ROMEO', 'HIDDEN-FIELD-TANGO', 'ATTACHMENT-SECRET-UNIFORM', 'payroll-2024.csv', 'PIECEINFO-SECRET'];

module.exports = {
  'inspect finds every planted item, including an earlier revision': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const r = await LE.pdfSecurity.inspect(await SecFixtures.reveal());
      const v = await LE.pdfSecurity.inspect(await SecFixtures.revisions());
      const flat = (rep) => { const o = {}; rep.groups.forEach((g) => { o[g.id] = g.items.map((i) => i.label + ' ' + i.value).join(' | '); }); return o; };
      return { ok: r.ok !== false, summary: r.summary, groups: flat(r), counts: r.counts, rev: flat(v), revCount: v.revisions };
    });
    h.assert(res.ok, 'inspect failed');
    Object.keys(REVEAL_MARKERS).forEach((g) => REVEAL_MARKERS[g].forEach((m) => h.assert(res.groups[g] && res.groups[g].indexOf(m) >= 0, 'group ' + g + ' is missing ' + m + ': ' + res.groups[g])));
    h.assert(/This PDF carries \d+ details/.test(res.summary), 'summary: ' + res.summary);
    h.assert(res.groups.hiddenText.indexOf('Normal visible body text') < 0, 'visible text reported as hidden');
    h.assert.equal(res.revCount, 2, 'revision count');
    h.assert(/OLD-TITLE-VICTOR/.test(res.rev.revisions) && /REVISION-SECRET-WHISKEY/.test(res.rev.revisions), 'earlier revision content not shown: ' + res.rev.revisions);
    h.assert.noErrors(page);
  },

  'scrub removes every category, rewrites the file and the re-inspection is clean': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async (gone) => {
      const S = LE.pdfSecurity;
      const out = await S.scrub(await SecFixtures.reveal(), { forms: 'remove' });
      const after = out.report.after;
      const left = after.groups.filter((g) => g.removable && g.count).map((g) => g.id + ':' + g.count);
      const found = (await S.searchFile(out, gone)).found.map((f) => f.text + ' ' + f.where);
      const raw = new TextDecoder('latin1').decode(out);
      const rawHits = ['EXIF-ARTIST-HOTEL', 'SecretCam', 'PhotoTool', 'DEADBEEF', 'FORM-VALUE-SIERRA'].filter((s) => raw.indexOf(s) >= 0 || raw.indexOf(s.split('').map((c) => c.charCodeAt(0).toString(16)).join('').toUpperCase()) >= 0);
      const text = (await S.textIndex(out)).pages.map((p) => p.text).join('\n');
      const st = await S.scanStructure(out);
      /* The earlier revision's text and title must be gone too. */
      const rv = await S.scrub(await SecFixtures.revisions());
      const rvFound = (await S.searchFile(rv, ['REVISION-SECRET-WHISKEY', 'OLD-TITLE-VICTOR', 'Original Author'])).found;
      const rvRaw = new TextDecoder('latin1').decode(rv);
      const rvSt = await S.scanStructure(rv);
      const rvText = (await S.textIndex(rv)).pages[0].text;
      return { ok: out.report.ok, left, found, rawHits, text, revisions: st.revisions, prev: st.prevLinks, rvFound, rvRawHit: rvRaw.indexOf('WHISKEY') >= 0, rvRev: rvSt.revisions, rvText, leftovers: after.counts.leftovers };
    }, GONE);
    h.assert(res.ok, 'scrub failed');
    h.assert.equal(res.left.length, 0, 'groups left after scrub: ' + res.left.join(', '));
    h.assert.equal(res.found.length, 0, 'still in file: ' + res.found.join('; '));
    h.assert.equal(res.rawHits.length, 0, 'still in raw bytes: ' + res.rawHits.join(', '));
    h.assert(/Visible heading for the review/.test(res.text) && /Normal visible body text stays/.test(res.text), 'visible text lost: ' + res.text);
    h.assert(!/INVISIBLE|WHITE-SECRET|UNDER-IMAGE/.test(res.text), 'hidden text still extractable: ' + res.text);
    h.assert.equal(res.revisions, 1, 'output revisions');
    h.assert.equal(res.prev, 0, 'output has /Prev');
    h.assert.equal(res.rvFound.length, 0, 'earlier revision still inside: ' + JSON.stringify(res.rvFound));
    h.assert(!res.rvRawHit, 'earlier revision text in raw bytes');
    h.assert.equal(res.rvRev, 1, 'revisions after scrub');
    h.assert(/withheld/.test(res.rvText), 'current text lost: ' + res.rvText);
    h.assert.equal(res.leftovers, 0, 'leftovers');
    h.assert.noErrors(page);
  },

  'scrub options remove one category at a time': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity;
      const src = await SecFixtures.reveal();
      const none = { metadata: false, documentId: false, attachments: false, forms: 'keep', comments: 'keep', links: false, hiddenText: false, thumbnails: false, imageMeta: false };
      const cases = [['metadata', 'info'], ['metadata', 'xmp'], ['documentId', 'id'], ['attachments', 'attachments'], ['forms', 'forms', 'flatten'], ['comments', 'comments', 'remove'], ['links', 'links'], ['hiddenText', 'hiddenText'], ['hiddenText', 'layers'], ['thumbnails', 'thumbnails'], ['imageMeta', 'imageMeta']];
      const out = [];
      for (const c of cases) {
        const o = Object.assign({}, none); o[c[0]] = c[2] || true;
        const r = await S.scrub(src, o);
        const a = r.report.after.counts;
        out.push({ opt: c[0], group: c[1], after: a[c[1]], untouched: c[1] === 'comments' ? a.attachments : a.comments });
      }
      return out;
    });
    res.forEach((r) => {
      if (r.group === 'layers') h.assert(r.after <= 0, 'layers left: ' + r.after);
      else h.assert.equal(r.after, 0, r.opt + ' left ' + r.group);
      h.assert(r.untouched > 0, r.opt + ' also removed an unrelated group');
    });
    h.assert.noErrors(page);
  },

  'safetyCheck flags every planted active element and the safe copy has none': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity;
      const src = await SecFixtures.active();
      const r = await S.safetyCheck(src);
      const safe = await S.makeSafe(src);
      const found = (await S.searchFile(safe, ['OPENACTION-JS-ALPHA', 'DOCLEVEL-JS-BRAVO', 'CATALOG-AA-CHARLIE', 'PAGE-AA-DELTA', 'LAUNCH-ECHO', 'FIELD-AA-FOXTROT', 'NEXT-JS-GOLF', 'XFA-HOTEL', 'DISGUISED-JS-INDIA', 'evil.example.com', 'collect.example.net', 'invoice.exe'])).found;
      const raw = new TextDecoder('latin1').decode(safe);
      const opens = (await S.textIndex(safe)).pages.map((p) => p.text).join(' ');
      return {
        level: r.level, text: r.findings.map((f) => f.level + ':' + f.kind + ':' + f.title + ':' + (f.code || f.detail)).join('\n'),
        after: safe.report.after.level, afterFindings: safe.report.after.findings.map((f) => f.level + ':' + f.kind), found, rawActive: (raw.match(/\/(JavaScript|JS|AA|OpenAction|Launch|RichMedia|XFA|SubmitForm|ImportData|GoToR|EmbeddedFiles)\b/g) || []), opens
      };
    });
    h.assert.equal(res.level, 'danger', 'verdict');
    ['OPENACTION-JS-ALPHA', 'DOCLEVEL-JS-BRAVO', 'CATALOG-AA-CHARLIE', 'PAGE-AA-DELTA', 'FIELD-AA-FOXTROT', 'NEXT-JS-GOLF', 'LAUNCH-ECHO', 'other-file.pdf', 'data.fdf', 'collect.example.net', 'invoice.exe', 'notes.txt', 'tracker.example.org'].forEach((m) => h.assert(res.text.indexOf(m) >= 0, 'not flagged: ' + m));
    ['danger:launch', 'danger:attachment', 'caution:xfa', 'caution:media', 'caution:external', 'caution:disguised', 'caution:submit', 'caution:goto', 'caution:import', 'caution:leftover', 'info:revisions', 'info:uri'].forEach((k) => h.assert(res.text.indexOf(k) >= 0, 'missing finding ' + k));
    h.assert.equal(res.after, 'safe', 'safe copy verdict: ' + res.afterFindings.join(', '));
    h.assert.equal(res.found.length, 0, 'left in safe copy: ' + JSON.stringify(res.found));
    h.assert.equal(res.rawActive.length, 0, 'active names in safe copy: ' + res.rawActive.join(' '));
    h.assert(/Invoice 2291/.test(res.opens), 'safe copy lost its page text');
    h.assert.noErrors(page);
  },

  'redaction removes the content under the boxes and leaves other pages untouched': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity, B = SecFixtures.REDACT_BOXES;
      const src = await SecFixtures.redact();
      const out = await S.redact(src, [{ page: 0, rects: [B.name, B.amount, B.image] }], { dpi: 150, label: 'REDACTED' });
      const ix = await S.textIndex(out);
      const raw = await S.searchFile(out, ['REDACT-NAME-ZULU', 'REDACT-AMOUNT-YANKEE', 'REDACT-NOTE-XRAY', 'Case file for']);
      /* Unaffected pages: same drawing bytes and same text. */
      async function pageStreams(bytes) {
        const doc = await PDFLib.PDFDocument.load(bytes);
        const out2 = [];
        for (const p of doc.getPages()) {
          const c = p.node.Contents();
          const list = c instanceof PDFLib.PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
          out2.push(list.map((s) => Array.from(PDFLib.decodePDFRawStream(s).decode()).join(',')).join('|'));
        }
        return out2;
      }
      const a = await pageStreams(src), b = await pageStreams(out);
      const srcIx = await S.textIndex(src);
      const annots = (await PDFLib.PDFDocument.load(out)).getPages()[0].node.Annots();
      return {
        ok: out.report.ok, verify: out.report.verify, captured: out.report.captured, p1: ix.pages[0].text, p2: ix.pages[1].text, p3: ix.pages[2].text,
        srcP2: srcIx.pages[1].text, srcP3: srcIx.pages[2].text, raw: raw.found, same2: a[1] === b[1], same3: a[2] === b[2], links: annots ? annots.size() : 0
      };
    });
    h.assert(res.ok && res.verify.ok, 'verify failed: ' + JSON.stringify(res.verify.problems));
    h.assert(res.captured.indexOf('REDACT-NAME-ZULU') >= 0, 'capture missed the name: ' + res.captured);
    h.assert.equal(res.p1.trim(), '', 'page 1 still has text');
    h.assert.equal(res.raw.length, 0, 'still stored: ' + JSON.stringify(res.raw));
    h.assert(res.same2 && res.same3, 'unaffected page drawing changed');
    h.assert.equal(res.p2, res.srcP2, 'page 2 text changed');
    h.assert.equal(res.p3, res.srcP3, 'page 3 text changed');
    h.assert.equal(res.links, 1, 'the link clear of the boxes should stay, the comment under a box should go');
    h.assert(res.verify.warnings.some((w) => /page 2/.test(w)), 'no warning about the name on page 2');
    h.assert(res.verify.checks.length >= 5 && res.verify.checks.every((c) => c.ok), 'checks: ' + JSON.stringify(res.verify.checks));
    h.assert.noErrors(page);
  },

  'keep-text-selectable redaction deletes only the letters under the boxes, or falls back to a picture': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity, B = SecFixtures.REDACT_BOXES;
      const src = await SecFixtures.redact();
      const a = await S.redact(src, [{ page: 0, rects: [B.name, B.amount] }], { mode: 'searchable', label: 'REDACTED' });
      const ixa = await S.textIndex(a);
      const rawA = (await S.searchFile(a, ['REDACT-NAME-ZULU', 'REDACT-AMOUNT-YANKEE', '98,500'])).found;
      /* Part of one word: only those letters go. */
      const f = await S.findSensitive(src, { terms: ['ZULU'], wholeWords: false, kinds: [] });
      const part = await S.redact(src, f.matches.filter((m) => m.page === 0).map((m) => ({ page: 0, rects: m.rects })), { mode: 'searchable' });
      const ixp = await S.textIndex(part);
      /* A picture under a box: that page becomes a picture. */
      const b = await S.redact(src, [{ page: 0, rects: [B.name, B.image] }], { mode: 'searchable' });
      const ixb = await S.textIndex(b);
      /* Many boxes across two pages from find sensitive data. */
      const sen = await SecFixtures.sensitive();
      const hits = await S.findSensitive(sen);
      const c = await S.redact(sen, hits.matches.map((m) => ({ page: m.page, rects: m.rects })), { mode: 'searchable' });
      const ixc = await S.textIndex(c);
      const leftC = hits.matches.filter((m) => ixc.pages[m.page].text.indexOf(m.text) >= 0).map((m) => m.text);
      return {
        a: { ok: a.report.ok, modes: a.report.pageModes, text: ixa.pages[0].text, raw: rawA },
        part: { ok: part.report.ok, modes: part.report.pageModes, text: ixp.pages[0].text },
        b: { ok: b.report.ok, modes: b.report.pageModes, fb: b.report.fallbacks, text: ixb.pages[0].text },
        c: { ok: c.report.ok, modes: c.report.pageModes, left: leftC, text: ixc.pages[0].text }
      };
    });
    h.assert(res.a.ok, 'selectable redaction not verified');
    h.assert.equal(res.a.modes[0], 'searchable', 'page 1 mode');
    h.assert(/Account holder:/.test(res.a.text) && /Keep this line visible\./.test(res.a.text), 'kept text lost: ' + res.a.text);
    h.assert(!/ZULU|YANKEE|98,500|Salary/.test(res.a.text), 'redacted text still extractable: ' + res.a.text);
    h.assert.equal(res.a.raw.length, 0, 'raw: ' + JSON.stringify(res.a.raw));
    h.assert(res.part.ok && res.part.modes[0] === 'searchable', 'partial word');
    h.assert(/REDACT-NAME/.test(res.part.text) && !/ZULU/.test(res.part.text), 'partial word text: ' + res.part.text);
    h.assert(res.b.ok && res.b.modes[0] === 'image' && /picture/.test(res.b.fb[0].reason), 'fallback: ' + JSON.stringify(res.b));
    h.assert.equal(res.b.text.trim(), '', 'fallback page still has text');
    h.assert(res.c.ok, 'many boxes not verified');
    h.assert.equal(res.c.left.length, 0, 'found text left: ' + res.c.left.join(', '));
    h.assert(/Card bad: 4111 1111 1111 1112/.test(res.c.text), 'unmarked text lost: ' + res.c.text);
    h.assert.noErrors(page);
  },

  'verify reports failure for a cover-only redaction': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity, B = SecFixtures.REDACT_BOXES;
      const src = await SecFixtures.redact();
      const plan = await S.capture(src, [{ page: 0, rects: [B.name, B.amount] }]);
      const doc = await PDFLib.PDFDocument.load(src);
      const pg = doc.getPage(0);
      [B.name, B.amount].forEach((b) => pg.drawRectangle({ x: b.x, y: 841.89 - b.y - b.h, width: b.w, height: b.h, color: PDFLib.rgb(0, 0, 0) }));
      const fake = await doc.save();
      const v = await S.verifyRedaction(fake, plan);
      return { strings: plan.strings, v };
    });
    h.assert(res.strings.indexOf('REDACT-NAME-ZULU') >= 0, 'plan strings: ' + res.strings);
    h.assert.equal(res.v.ok, false, 'cover-only redaction passed verification');
    h.assert(res.v.problems.some((p) => /Text is still under a box on page 1/.test(p) && /ZULU/.test(p)), 'problem not precise: ' + res.v.problems.join(' | '));
    h.assert(res.v.problems.some((p) => /file details/.test(p)), 'title leak not reported: ' + res.v.problems.join(' | '));
    h.assert.noErrors(page);
  },

  'findSensitive hits and misses with page rectangles': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity, V = S.validate;
      const units = {
        luhn: [V.luhn('4111111111111111'), V.luhn('4111111111111112')],
        iban: [V.iban('GB82 WEST 1234 5698 7654 32'), V.iban('GB82 WEST 1234 5698 7654 33'), V.iban('DE89370400440532013000')],
        verhoeff: [V.verhoeff(SecFixtures.aadhaar(true)), V.verhoeff(SecFixtures.aadhaar(false))],
        aba: [V.aba('021000021'), V.aba('021000022')],
        ssn: [V.ssn('219-09-9999'), V.ssn('000-12-3456'), V.ssn('666-12-3456')]
      };
      const phone = (t) => S.scanText(t, { kinds: ['phone'] }).map((x) => x.text);
      const phones = {
        hits: ['Call +1 (415) 555-0132 now', 'Tel: 020 7946 0958', 'Mobile 98765 43210', '+91-98765-43210', '+49 30 901820', 'phone: 415.555.0132'].map(phone),
        misses: ['Order 1234 5678', 'Total 2024 2025', 'Invoice 12 34', 'Version 1.2.3.4'].map(phone)
      };
      const f = await S.findSensitive(await SecFixtures.sensitive(), { terms: ['Priya Raman'] });
      return { units, phones, matches: f.matches.map((m) => ({ page: m.page, kind: m.kind, text: m.text, r: m.rects[0], n: m.rects.length })), pages: f.pages };
    });
    const u = res.units;
    h.assert(u.luhn[0] && !u.luhn[1], 'luhn');
    h.assert(u.iban[0] && !u.iban[1] && u.iban[2], 'iban');
    h.assert(u.verhoeff[0] && !u.verhoeff[1], 'verhoeff');
    h.assert(u.aba[0] && !u.aba[1], 'aba');
    h.assert(u.ssn[0] && !u.ssn[1] && !u.ssn[2], 'ssn');
    res.phones.hits.forEach((x, i) => h.assert(x.length === 1, 'phone not found in case ' + i + ': ' + JSON.stringify(x)));
    res.phones.misses.forEach((x, i) => h.assert.equal(x.length, 0, 'false phone in case ' + i + ': ' + JSON.stringify(x)));
    const by = (k) => res.matches.filter((m) => m.kind === k);
    const has = (k, t) => by(k).some((m) => m.text.replace(/\s+/g, ' ') === t);
    h.assert(has('email', 'priya.raman@example.co.uk'), 'email');
    h.assert(has('phone', '+44 20 7946 0958') && has('phone', '(415) 555-0132') && has('phone', '+91 98765 43210'), 'phones: ' + JSON.stringify(by('phone')));
    h.assert(has('url', 'https://www.example.org/path?q=1'), 'url');
    h.assert(has('ip', '192.168.10.42') && !has('ip', '999.1.1.1'), 'ip');
    h.assert(has('dob', '14/03/1987'), 'dob');
    h.assert(has('card', '4111 1111 1111 1111') && by('card').length === 1, 'cards: ' + JSON.stringify(by('card')));
    h.assert(has('iban', 'GB82 WEST 1234 5698 7654 32') && by('iban').length === 1, 'ibans');
    h.assert(has('ssn', '219-09-9999') && by('ssn').length === 1, 'ssn');
    h.assert.equal(by('aadhaar').length, 1, 'aadhaar count');
    h.assert(has('pan', 'ABCPE1234F'), 'pan');
    h.assert(by('idPossible').some((m) => m.text === 'K1234567'), 'passport possible');
    h.assert(by('bankPossible').length >= 2 && has('routing', '021000021'), 'bank numbers');
    h.assert(!res.matches.some((m) => /1234 5678/.test(m.text)), 'order total flagged');
    h.assert(by('term').some((m) => m.page === 1 && m.text === 'Priya Raman'), 'own term');
    h.assert(res.matches.filter((m) => m.kind === 'email').length === 2, 'email on both pages');
    /* Rectangles: the email sits on the first line, after "Email: ", 11 pt type, baseline at 800 pt from the bottom. */
    const em = by('email').find((m) => m.page === 0).r;
    h.assert(em.x > 70 && em.x < 95 && em.y > 22 && em.y < 38 && em.w > 120 && em.w < 175 && em.h > 9 && em.h < 22, 'email rect ' + JSON.stringify(em));
    const card = by('card')[0].r;
    h.assert(Math.abs(card.y - (841.89 - 800 + 7 * 22 - 11)) < 8, 'card rect y ' + JSON.stringify(card));
    h.assert.equal(res.pages[2].status, 'picture', 'scanned page');
    h.assert.noErrors(page);
  },

  'safe to send produces a clean, openable file': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity;
      const out = await S.safeToSend(await SecFixtures.active(), { flatten: true });
      const out2 = await S.safeToSend(await SecFixtures.reveal(), { flatten: true });
      const ix = await S.textIndex(out2);
      return { ok: out.report.ok, checks: out.report.checks, safety: out.report.after.safety.level, ok2: out2.report.ok, checks2: out2.report.checks, pages: ix.pageCount, text: ix.pages[0].text, steps: out2.report.steps.map((s) => s.label) };
    });
    h.assert(res.ok, 'active: ' + JSON.stringify(res.checks.filter((c) => !c.ok)));
    h.assert.equal(res.safety, 'safe', 'active safe-to-send verdict');
    h.assert(res.ok2, 'reveal: ' + JSON.stringify(res.checks2.filter((c) => !c.ok)));
    h.assert.equal(res.pages, 2, 'pages');
    h.assert(/Visible heading/.test(res.text), 'text lost');
    h.assert.equal(res.steps.length, 5, 'steps');
    h.assert.noErrors(page);
  },

  'a locked (encrypted) file is read but never rewritten': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity;
      const b = await SecFixtures.locked();
      const r = await S.inspect(b);
      const sc = await S.scrub(b);
      const mk = await S.makeSafe(b);
      const rd = await S.redact(b, [{ page: 0, rects: [{ x: 40, y: 60, w: 200, h: 30 }] }]);
      const sf = await S.safetyCheck(b);
      const flat = r.groups.map((g) => g.items.map((i) => i.label + ' ' + i.value).join(' ')).join(' | ');
      return { enc: r.encrypted, flat, removable: r.groups.some((g) => g.removable), scrub: [sc.length, sc.report.code, sc.report.error], safe: mk.length, red: rd.length, level: sf.level, kinds: sf.findings.map((f) => f.kind) };
    });
    h.assert(res.enc, 'not marked as encrypted');
    ['LOCKED-TITLE-KAPPA', 'LOCKED-AUTHOR-MU', 'LOCKED-NOTE-LAMBDA'].forEach((m) => h.assert(res.flat.indexOf(m) >= 0, 'not read: ' + m));
    h.assert(!res.removable, 'removal offered for a locked file');
    h.assert(res.scrub[0] === 0 && res.scrub[1] === 'encrypted' && /lock/.test(res.scrub[2]), 'scrub: ' + res.scrub);
    h.assert(res.safe === 0 && res.red === 0, 'a locked file was rewritten');
    h.assert(res.kinds.indexOf('encrypted') >= 0, 'safety check does not mention the lock');
    h.assert.noErrors(page);
  },

  'malformed and hostile inputs neither throw nor hang': async ({ browser, base, h }) => {
    const page = await secPage(h, browser, base);
    const res = await page.evaluate(async () => {
      const S = LE.pdfSecurity;
      const hs = await SecFixtures.hostile();
      hs.notBytes = { foo: 1 };
      hs.nothing = null;
      const out = {};
      for (const k of Object.keys(hs)) {
        const t0 = performance.now();
        const timeout = new Promise((r) => setTimeout(() => r('TIMEOUT'), 25000));
        const all = Promise.all([
          S.inspect(hs[k]), S.safetyCheck(hs[k]), S.findSensitive(hs[k]), S.scrub(hs[k]), S.makeSafe(hs[k]),
          S.redact(hs[k], [{ page: 0, rects: [{ x: 1, y: 1, w: 10, h: 10 }] }]), S.safeToSend(hs[k]), S.textIndex(hs[k])
        ]).then((r) => r.map((x) => (x && x.report ? 'bytes:' + x.length + ':' + (x.report.ok === false ? 'fail' : 'ok') : x && x.ok === false ? 'fail' : 'ok')));
        try { out[k] = { r: await Promise.race([all, timeout]), ms: Math.round(performance.now() - t0) }; }
        catch (e) { out[k] = { threw: String(e && e.message) }; }
      }
      return out;
    });
    Object.keys(res).forEach((k) => {
      h.assert(!res[k].threw, k + ' threw: ' + res[k].threw);
      h.assert(res[k].r !== 'TIMEOUT', k + ' hung');
    });
    /* Random bytes: every call fails softly; the safety check answers with a "could not be read" caution instead. */
    h.assert(res.random.r.filter((x, i) => i !== 1).every((x) => /fail/.test(x)), 'random bytes should fail softly: ' + res.random.r);
    h.assert.noErrors(page, [/Warning|Indexing all PDF objects|Invalid|Failed to load resource/i]);
  },

  'no cross-origin requests during the whole suite': async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/pdf-studio/');
    const outside = [];
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) outside.push(u); });
    await page.addScriptTag({ url: base + '/tests/fixtures/pdf-security/fixtures.js' });
    await page.evaluate(async () => {
      await LE.pdf.ready();
      const S = LE.pdfSecurity;
      const a = await SecFixtures.active(), r = await SecFixtures.reveal();
      await S.inspect(r); await S.safetyCheck(a); await S.makeSafe(a); await S.scrub(r);
      await S.findSensitive(await SecFixtures.sensitive());
      await S.redact(await SecFixtures.redact(), [{ page: 0, rects: [SecFixtures.REDACT_BOXES.name] }]);
    });
    h.assert.equal(outside.length, 0, 'outside requests: ' + outside.join(', '));
  },

  'Protect panel: reveal, remove all and before/after at desktop': async ({ browser, base, h }) => {
    const page = await studioWith(h, browser, base, 'desktop', 'reveal');
    h.assert(await page.$('#ps-rail [data-panel="security"]'), 'no Protect tab');
    h.assert(/never leaves/.test(await page.textContent('.sec-private')), 'privacy line');
    await page.click('[data-sec="reveal"]');
    await page.waitForSelector('.sec-group', { timeout: 30000 });
    const groups = await page.$$eval('.sec-group', (g) => g.map((x) => x.getAttribute('data-group')));
    ['info', 'attachments', 'forms', 'comments', 'hiddenText'].forEach((g) => h.assert(groups.includes(g), 'group not shown: ' + g));
    await page.click('[data-sec-run="scrub"]');
    await page.waitForSelector('.sec-ba', { timeout: 60000 });
    const afterCells = await page.$$eval('.sec-ba tbody td:last-child', (c) => c.map((x) => x.textContent.trim()));
    h.assert(afterCells.length > 5 && afterCells.every((t) => t === '0'), 'after column: ' + afterCells.join(','));
    h.assert(await page.$('[data-sec-download]'), 'download button');
    const ink = await page.$eval('[data-sec-download]', (b) => getComputedStyle(b).color);
    h.assert.equal(ink, 'rgb(42, 31, 10)', 'gold button ink');
    h.assert.noErrors(page);
  },

  'Protect panel: safety verdict and safe copy at phone': async ({ browser, base, h }) => {
    const page = await studioWith(h, browser, base, 'phone', 'active');
    await page.click('[data-sec="safety"]');
    await page.waitForSelector('.sec-verdict', { timeout: 30000 });
    h.assert.equal(await page.getAttribute('.sec-verdict', 'data-level'), 'danger', 'verdict');
    h.assert(await h.noOverflow(page), 'sideways scroll at 390');
    await page.click('[data-sec-run="safe"]');
    await page.waitForSelector('.sec-result .sec-card-ok', { timeout: 60000 });
    const size = await page.$eval('[data-sec-download]', (b) => b.getBoundingClientRect().height);
    h.assert(size >= 44, 'download target ' + size);
    h.assert(await h.noOverflow(page), 'sideways scroll after result');
    h.assert.noErrors(page);
  },

  'Protect panel: draw, find and redact with verification at 360 px': async ({ browser, base, h }) => {
    const page = await studioWith(h, browser, base, 'small', 'redact');
    await page.click('[data-sec="redact"]');
    h.assert(await h.noOverflow(page), 'sideways scroll at 360');
    await page.click('[data-sec-find]');
    await page.fill('#sec-terms', 'REDACT-NAME-ZULU');
    await page.click('[data-sec-search]');
    await page.waitForSelector('.sec-hits input', { timeout: 30000 });
    const hits = await page.$$eval('.sec-hits .sec-hit-t b', (b) => b.map((x) => x.textContent));
    h.assert(hits.filter((x) => x === 'REDACT-NAME-ZULU').length === 2, 'term hits: ' + hits);
    /* Keep only page 1 */
    await page.evaluate(() => { PS.security.hits.matches.forEach((m) => { m.on = m.page === 0; }); });
    await page.click('[data-sec-add]');
    await page.waitForFunction(() => Object.keys(PS.security.marks).length === 1);
    /* Draw a second box with the pointer over the picture on page 1. */
    await page.evaluate(() => { PS.setSheet('closed'); PS.goTo(0, true); });
    await page.evaluate(() => PS.security.setDrawing(true));
    const box = await page.$eval('.pv-page[data-uid]', (p) => { const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const sx = box.x + box.w * (340 / 595.28), sy = box.y + box.h * (140 / 841.89);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + box.w * 0.1, sy + box.h * 0.05, { steps: 4 });
    await page.mouse.up();
    const count = await page.evaluate(() => Object.values(PS.security.marks).reduce((n, l) => n + l.length, 0));
    h.assert.equal(count, 2, 'marks after drawing');
    await page.evaluate(() => { PS.security.setDrawing(false); PS.openPanel('security'); PS.security.go('redact'); });
    await page.waitForSelector('[data-sec-run="redact"]:not([disabled])');
    await page.click('[data-sec-run="redact"]');
    await page.waitForSelector('#ps-dialog[open]');
    await page.click('#ps-dialog button[type="submit"]');
    await page.waitForSelector('[data-verified]', { timeout: 90000 });
    h.assert.equal(await page.getAttribute('[data-verified]', 'data-verified'), 'true', 'not verified: ' + await page.textContent('.sec-result'));
    const result = await page.evaluate(async () => {
      const b = PS.security.results.redact.bytes;
      const ix = await LE.pdfSecurity.textIndex(b);
      return { p1: ix.pages[0].text, p2: ix.pages[1].text, orig: (await PS.S.docs[PS.S.pages[0].docId].text(0)).text };
    });
    h.assert(!/ZULU/.test(result.p1), 'name left on page 1');
    h.assert(/ZULU/.test(result.p2), 'page 2 should be untouched');
    h.assert(/ZULU/.test(result.orig), 'original changed');
    h.assert(await h.noOverflow(page), 'sideways scroll after redaction');
    h.assert.noErrors(page);
  }
};
