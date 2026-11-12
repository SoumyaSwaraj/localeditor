'use strict';
/* Scanned-PDF text lab: nothing loads until asked; one small generated page is recognised and written back as a searchable PDF
 * that pdf.js can reopen and extract text from. English "fast" tier (tesseract.js-core LSTM + tessdata_fast), single thread. */
const cases = {};

async function fixturePng(page) {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 420;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 420); x.fillStyle = '#111';
    x.font = '44px "Liberation Sans", Arial, sans-serif';
    x.fillText('Invoice 4471 was paid', 50, 100);
    x.fillText('Total due 1,250.00 EUR', 50, 190);
    x.fillText('Account GB29 NWBK 6016', 50, 280);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(data, 'base64');
}

cases['lab fetches nothing until asked'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/pdf-ocr/index.html', 'desktop');
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  h.assert(!urls.some((u) => /tesseract|traineddata|worker\.min/.test(u)), 'Engine or language data fetched before the user asked: ' + urls.join(', '));
  h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), false, 'Model cache created before the user asked');
  h.assert.equal(await page.evaluate(() => LE.ocr.languages().length >= 7 && LE.ocr.languages()[0].id === 'eng'), true);
  h.assert.equal(await page.evaluate(() => (window.LE_SUPPORT_DEFS || []).some((d) => d.id === 'ocr.english-fast')), true, 'Support declaration missing');
  h.assert.noErrors(page);
};

cases['recognises a generated page and writes a searchable PDF'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/pdf-ocr/index.html', 'desktop');
  await page.setInputFiles('#file', { name: 'scan.png', mimeType: 'image/png', buffer: await fixturePng(page) });
  await page.waitForFunction(() => !document.getElementById('run').disabled);
  await page.click('#run');
  await page.waitForFunction(() => window.__ocrDone || window.__ocrError, null, { timeout: 80000 });
  h.assert(!(await page.evaluate(() => window.__ocrError)), 'Recognise failed: ' + (await page.evaluate(() => window.__ocrError)));
  const r = await page.evaluate(() => window.__ocrResult);
  h.assert(/Invoice/i.test(r.text) && /4471/.test(r.text) && /1,250\.00/.test(r.text), 'Unexpected text: ' + r.text);
  h.assert(r.words >= 9, 'Expected at least 9 words, got ' + r.words);
  h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), true, 'Language data was not cached');
  await page.click('#make');
  await page.waitForFunction(() => window.__ocrDone || window.__ocrError, null, { timeout: 80000 });
  h.assert(!(await page.evaluate(() => window.__ocrError)), 'Make searchable failed: ' + (await page.evaluate(() => window.__ocrError)));
  const o = await page.evaluate(() => window.__ocrOutput);
  h.assert(o.verify.pages === 1 && o.verify.extractedWords >= 9, 'pdf.js extracted too little: ' + JSON.stringify(o.verify));
  h.assert(o.verify.recall >= 0.9, 'Reopened text does not match the recognised text: ' + o.verify.recall);
  h.assert(/4471/.test(o.verify.sample), 'Search text missing the invoice number: ' + o.verify.sample);
  await page.evaluate(() => LE.ocr.unload());
  h.assert.equal(await page.evaluate(() => LE.ocr.isLoaded()), null);
  h.assert.noErrors(page);
};

module.exports = cases;
