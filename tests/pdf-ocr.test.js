'use strict';
/* D9 "Make searchable" in the PDF studio (assets/js/le-pdf-ocr.js): nothing loads until asked; the scanned fixture
 * (scripts/fixtures/scanned.pdf: two scanned pages and one text page) gets an invisible text layer that pdf.js can search;
 * Cancel leaves the document exactly as it was; Find sensitive data can read scanned pages first; phone sizes.
 * English "fast" tier (tesseract.js-core LSTM + tessdata_fast), single thread. Regenerate the fixture with
 * node scripts/fixtures/make-scanned-pdf.js. */
const fs = require('fs');
const cases = {};

const ENGINE_RE = /\/tesseract\/|traineddata/;   /* the engine, its worker and language data (pdf.js has its own worker) */

async function studioWithScan(h, browser, base, viewport) {
  const page = await h.open(browser, base, '/pdf-studio/', viewport || 'desktop');
  const b64 = fs.readFileSync(h.FIXTURE('scanned.pdf')).toString('base64');
  await page.evaluate(async (b) => {
    const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
    await PS.addFiles([new File([u], 'scanned.pdf', { type: 'application/pdf' })]);
  }, b64);
  await page.waitForFunction(() => PS.S.pages.length === 3);
  await page.waitForSelector('.por-offer:not([hidden])', { timeout: 20000 });
  return page;
}
async function engineRequests(page) {
  return page.evaluate((re) => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => new RegExp(re).test(u)), ENGINE_RE.source);
}
async function waitDone(page, timeout) {
  await page.waitForFunction(() => PS.ocr.state.last && !PS.ocr.state.busy, null, { timeout: timeout || 80000 });
  return page.evaluate(() => PS.ocr.state.last);
}

cases['nothing is fetched or stored before the person asks'] = async ({ browser, base, h }) => {
  const page = await studioWithScan(h, browser, base, 'desktop');
  h.assert.equal((await page.textContent('.por-offer')).includes('This PDF is a scan') || (await page.textContent('.por-offer')).includes('2 pages are scans'), true, 'offer should name the scanned pages');
  await page.evaluate(() => PS.openPanel('scan'));
  await page.waitForSelector('.por-read [data-por="go"]');
  h.assert(/2 pages of 3 are scans/.test(await page.textContent('.por-status')), 'status line: ' + await page.textContent('.por-status'));
  await page.waitForTimeout(400);
  h.assert.equal((await engineRequests(page)).length, 0, 'engine or language data fetched before the person asked');
  h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), false, 'model cache created before the person asked');
  h.assert.equal(await page.evaluate(() => LE.ocr.isLoaded()), null);
  h.assert.equal(await page.evaluate(() => (window.LE_SUPPORT_DEFS || []).some((d) => d.id === 'ocr.read' && d.needs.includes('wasm'))), true, 'support declaration missing');
  const words = await page.evaluate(() => document.querySelector('.por-pane').textContent);
  h.assert(!/\bOCR\b|Tesseract|WASM|WebAssembly/i.test(words), 'technical words in the panel: ' + words);
  h.assert.noErrors(page);
};

cases['a scanned PDF becomes searchable: pdf.js finds the words, the text page is untouched, Undo restores'] = async ({ browser, base, h }) => {
  const page = await studioWithScan(h, browser, base, 'desktop');
  const oldDoc = await page.evaluate(() => PS.S.pages[0].docId);
  await page.click('[data-por-offer="go"]');
  const last = await waitDone(page);
  h.assert(last.ok, 'run failed: ' + JSON.stringify(last));
  h.assert.equal(last.report.pages, 2, 'two scanned pages read');
  h.assert(last.report.words >= 40, 'too few words: ' + last.report.words);
  /* the studio now shows the searchable copy; the third page (real text) was not read again */
  const now = await page.evaluate(() => ({ ids: PS.S.pages.map((r) => r.docId), undo: PS.H.undo.map((u) => u.label) }));
  h.assert(now.ids[0] !== oldDoc && now.ids.every((id) => id === now.ids[0]), 'pages should point at the new document');
  h.assert(now.undo.includes('Make searchable'), 'no undo step');
  /* Save PDF output, reopened by pdf.js (the site's own copy, isEvalSupported: false) */
  const b64 = await page.evaluate(async () => { const out = await PS.buildPdf({}); let s = ''; for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i]); return btoa(s); });
  const read = await h.pdfRead(browser, base, Buffer.from(b64, 'base64'));
  h.assert.equal(read.pages, 3);
  ['Invoice', '4471', 'anna.berg@example.com', 'Northwind', 'Leeds', '88213', 'budget review'].forEach((w) => h.assert(read.text.indexOf(w) >= 0, 'pdf.js cannot find "' + w + '" in the saved PDF'));
  h.assert((read.text.split('\n')[2] || '').indexOf('Notes typed on a computer') >= 0, 'text page changed: ' + read.text.split('\n')[2]);
  /* Find in the studio sees the words too */
  h.assert(/4471/.test(await page.evaluate(() => PS.ocr.allText())), 'Copy text source lacks the invoice number');
  /* language data and engine are cached with an owner tag for the storage manager */
  const cached = await page.evaluate(async () => { const c = await caches.open('le-models-v1'); const ks = await c.keys(); const out = []; for (const k of ks) { const r = await c.match(k); out.push(r.headers.get('x-le-model')); } return out; });
  h.assert(cached.includes('ocr-eng') && cached.includes('ocr-engine'), 'cache entries: ' + cached.join(','));
  h.assert.equal(await page.evaluate(() => LE.ocr.isLoaded()), null, 'the engine should be unloaded after the job');
  /* Save text (.txt) */
  const dl = await h.capture(page, () => page.click('[data-por="save-text"]'));
  h.assert(/\.txt$/.test(dl.name) && /Leeds/.test(dl.buf.toString('utf8')), 'Save text: ' + dl.name);
  /* Undo puts the original (scanned, no text) document back */
  await page.evaluate(() => PS.undo());
  h.assert.equal(await page.evaluate(() => PS.S.pages[0].docId), oldDoc, 'undo did not restore the original');
  h.assert.noErrors(page);
};

cases['cancel mid-run leaves the document unchanged and frees the engine'] = async ({ browser, base, h }) => {
  const page = await studioWithScan(h, browser, base, 'desktop');
  const before = await page.evaluate(() => ({ ids: PS.S.pages.map((r) => r.docId), undo: PS.H.undo.length, bytes: PS.S.docs[PS.S.pages[0].docId]._bytes.length }));
  await page.click('[data-por-offer="go"]');
  await page.waitForFunction(() => /Page 1 of 2|Starting the text reader|Getting the text reader/.test(document.querySelector('#ps-progress .ps-prog-sub').textContent), null, { timeout: 30000 });
  await page.click('#ps-progress .ps-prog-cancel');
  const last = await waitDone(page, 30000);
  h.assert(last.stopped, 'expected a stopped run: ' + JSON.stringify(last));
  const after = await page.evaluate(() => ({ ids: PS.S.pages.map((r) => r.docId), undo: PS.H.undo.length, bytes: PS.S.docs[PS.S.pages[0].docId]._bytes.length, hidden: document.getElementById('ps-progress').hidden }));
  h.assert.equal(JSON.stringify(after.ids), JSON.stringify(before.ids), 'pages changed');
  h.assert.equal(after.undo, before.undo, 'an undo step was added');
  h.assert.equal(after.bytes, before.bytes, 'document bytes changed');
  h.assert(after.hidden, 'progress card still open');
  h.assert.equal(await page.evaluate(() => LE.ocr.isLoaded()), null, 'engine still loaded after cancel');
  h.assert(/Stopped/.test(await page.textContent('.por-read')), 'no stopped note');
  h.assert(/2 pages of 3 are scans/.test(await page.textContent('.por-status')), 'status should still report scans');
  h.assert.noErrors(page);
};

cases['Find sensitive data reads scanned pages when asked, and leaves those matches unticked'] = async ({ browser, base, h }) => {
  const page = await studioWithScan(h, browser, base, 'desktop');
  await page.evaluate(() => { PS.openPanel('security'); PS.security.findOpen = true; PS.security.go('redact'); });
  await page.waitForSelector('.sec-findbox [data-sec-search]');
  await page.click('.sec-findbox [data-sec-search]');
  await page.waitForSelector('.sec-findbox [data-por="find-scans"]', { timeout: 20000 });
  h.assert(/Pages 1 and 2 are scans/.test(await page.textContent('.por-findhint')), 'hint: ' + await page.textContent('.por-findhint'));
  await page.click('.sec-findbox [data-por="find-scans"]');
  await page.waitForFunction(() => PS.security.hits && PS.security.hits.readScans, null, { timeout: 80000 });
  const hits = await page.evaluate(() => PS.security.hits.matches.map((m) => ({ kind: m.kind, text: m.text, page: m.page, on: m.on, fromScan: !!m.fromScan })));
  const email = hits.find((m) => m.kind === 'email'), iban = hits.find((m) => m.kind === 'iban');
  h.assert(email && /anna\.berg@example\.com/.test(email.text) && email.page === 0, 'email not found on the scan: ' + JSON.stringify(hits));
  h.assert(iban && iban.page === 0, 'IBAN not found on the scan: ' + JSON.stringify(hits));
  h.assert(hits.filter((m) => m.fromScan).every((m) => !m.on), 'matches from a scan must start unticked');
  h.assert(await page.$('.sec-findbox [data-por="find-scans"]') === null, 'hint should be gone once the scans were read');
  /* the document in the studio is unchanged: the reading was only for the search */
  h.assert.equal(await page.evaluate(() => PS.H.undo.some((u) => u.label === 'Make searchable')), false);
  h.assert.noErrors(page);
};

cases['phone 390 and 360: the offer and the panel fit, 44 px targets, no sideways scroll'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studioWithScan(h, browser, base, vp);
    h.assert(await h.noOverflow(page), vp + ': sideways scroll with the offer');
    const sizes = await page.evaluate(() => ['[data-por-offer="go"]', '[data-por-offer="close"]'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
    sizes.forEach((s) => h.assert(s[1] >= 44 && s[2] >= 44, vp + ': small target ' + s.join(' ')));
    await page.click('#ps-rail [data-panel="scan"]');
    await page.waitForSelector('.por-read [data-por="go"]');
    h.assert(await h.noOverflow(page), vp + ': sideways scroll with the panel');
    const small = await page.evaluate(() => [].slice.call(document.querySelectorAll('.por-pane button, .por-pane select')).filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim().slice(0, 24), Math.round(r.height)]; }).filter((x) => x[1] < 44));
    h.assert(!small.length, vp + ': controls under 44 px: ' + JSON.stringify(small));
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['lab page uses the same engine and still fetches nothing until asked'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/pdf-ocr/index.html', 'desktop');
  h.assert.equal((await engineRequests(page)).length, 0);
  h.assert.equal(await page.evaluate(() => LE.ocr.languages()[0].id === 'eng' && typeof LE.ocr.status === 'function'), true);
  h.assert.equal(await page.evaluate(() => LE.ocr.available().then((a) => a[0])), 'eng');
  h.assert.noErrors(page);
};

module.exports = cases;
