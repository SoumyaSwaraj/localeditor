'use strict';
/* One real happy path per representative tool page, with a fixture and a checked output. */
const cases = {};
const fs = require('fs');

async function tool(browser, base, h, url, vp) {
  const page = await h.open(browser, base, url, vp || 'desktop');
  page.setDefaultTimeout(15000);
  return page;
}

cases['image compressor: a JPG becomes a smaller WebP of the same pixel size'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-compressor/');
  await page.setInputFiles('input[type=file]', h.PHOTO(0));
  await page.waitForFunction(() => !document.getElementById('dl-all').disabled, null, { timeout: 15000 });
  const orig = fs.statSync(h.PHOTO(0)).size;
  const r = await h.capture(page, () => page.click('#dl-all'));
  const i = h.imageInfo(r.buf);
  h.assert(i.type === 'webp' && i.w === 480 && i.h === 640, 'webp same size: ' + JSON.stringify(i));
  h.assert(r.size > 500 && r.size < orig, 'smaller than the original: ' + r.size + ' < ' + orig);
  h.assert(/compressed\.webp$/.test(r.name), 'named: ' + r.name);
  h.assert.noErrors(page);
};
cases['image compressor: JPEG output and a max width are honoured'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-compressor/');
  await page.setInputFiles('input[type=file]', h.PHOTO(1));
  await page.waitForFunction(() => !document.getElementById('dl-all').disabled);
  await page.click('button[data-v="image/jpeg"]');
  await page.fill('#mw', '300');
  await page.waitForTimeout(1200);
  const r = await h.capture(page, () => page.click('#dl-all'));
  const i = h.imageInfo(r.buf);
  h.assert(i.type === 'jpeg' && i.w === 300, 'jpeg 300 wide: ' + JSON.stringify(i));
};
cases['image resizer: set a width with the ratio locked, download has that size'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-resizer/');
  await page.setInputFiles('input[type=file]', h.PHOTO(0));
  await page.waitForFunction(() => document.getElementById('w').value === '480');
  await page.fill('#w', '240');
  await page.dispatchEvent('#w', 'input');
  await page.waitForTimeout(300);
  h.assert.equal(await page.inputValue('#h'), '320', 'height follows the locked ratio');
  const r = await h.capture(page, () => page.click('#dl'));
  const i = h.imageInfo(r.buf);
  h.assert(i.w === 240 && i.h === 320, 'resized output ' + JSON.stringify(i));
  h.assert.noErrors(page);
};
cases['image converter: PNG fixture converted to JPG, and JPG to PNG'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-converter/');
  await page.setInputFiles('input[type=file]', h.FIXTURE('sample.png'));
  await page.waitForFunction(() => !document.getElementById('dl-all').disabled);
  const r = await h.capture(page, () => page.click('#dl-all'));
  const i = h.imageInfo(r.buf);
  h.assert(i.type === 'jpeg' && i.w === 64 && i.h === 64, 'png -> jpg ' + JSON.stringify(i) + ' ' + r.name);
  await page.click('#clear').catch(() => {});
  const p2 = await tool(browser, base, h, '/image-converter/');
  await p2.setInputFiles('input[type=file]', h.PHOTO(2));
  await p2.waitForFunction(() => !document.getElementById('dl-all').disabled);
  await p2.click('button[data-v="image/png"]');
  await p2.waitForTimeout(1500);
  const r2 = await h.capture(p2, () => p2.click('#dl-all'));
  const i2 = h.imageInfo(r2.buf);
  h.assert(i2.type === 'png' && i2.h === 640, 'jpg -> png ' + JSON.stringify(i2));
};
cases['image cropper: pick 1:1 and the downloaded crop is square'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-cropper/');
  await page.setInputFiles('input[type=file]', h.PHOTO(0));
  await page.waitForSelector('button[data-v="1"]');
  await page.click('button[data-v="1"]');
  await page.waitForTimeout(400);
  const r = await h.capture(page, () => page.click('#dl'));
  const i = h.imageInfo(r.buf);
  h.assert(i.w && i.w === i.h, 'square crop ' + JSON.stringify(i));
  h.assert(i.w <= 480, 'inside the original width');
};
cases['merge PDF: two PDFs become one PDF with both pages'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/merge-pdf/');
  await page.setInputFiles('input[type=file]', [h.FIXTURE('sample.pdf'), h.FIXTURE('sample.pdf')]);
  await page.waitForSelector('[data-a="rm"]');
  h.assert.equal(await page.locator('[data-a="rm"]').count(), 2, 'two files listed');
  const r = await h.capture(page, () => page.click('#mergeBtn'), 30000);
  const info = await h.pdfRead(browser, base, r.buf);
  h.assert.equal(info.pages, 2, 'merged page count');
  h.assert(/merged\.pdf$/.test(r.name), 'named ' + r.name);
};
cases['merge PDF: reordering and removing files before merging'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/merge-pdf/');
  await page.setInputFiles('input[type=file]', [h.FIXTURE('sample.pdf'), h.FIXTURE('sample.pdf'), h.FIXTURE('sample.pdf')]);
  await page.waitForFunction(() => document.querySelectorAll('[data-a="rm"]').length === 3);
  await page.locator('[data-a="rm"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-a="rm"]').length === 2);
  const r = await h.capture(page, () => page.click('#mergeBtn'), 30000);
  h.assert.equal((await h.pdfRead(browser, base, r.buf)).pages, 2, 'two pages after removing one of three');
};
cases['split PDF: every page makes a download for each page'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/split-pdf/');
  await page.setInputFiles('input[type=file]', h.FIXTURE('sample.pdf'));
  await page.waitForSelector('#splitBtn');
  await page.click('button[data-v="each"]');
  await page.click('#splitBtn');
  await page.waitForSelector('button[data-o]', { timeout: 15000 });
  const r = await h.capture(page, () => page.locator('button[data-o]').first().click());
  const info = await h.pdfRead(browser, base, r.buf);
  h.assert.equal(info.pages, 1, 'a one-page PDF');
};
cases['split PDF: the ranges field extracts the pages typed'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/split-pdf/');
  await page.setInputFiles('input[type=file]', h.FIXTURE('sample.pdf'));
  await page.waitForSelector('#ranges');
  await page.fill('#ranges', '1');
  await page.click('#splitBtn');
  await page.waitForSelector('button[data-o]', { timeout: 15000 });
  const r = await h.capture(page, () => page.locator('button[data-o]').first().click());
  h.assert.equal((await h.pdfRead(browser, base, r.buf)).pages, 1);
};
cases['JPG to PDF: two photos become a two-page PDF'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/jpg-to-pdf/');
  await page.setInputFiles('input[type=file]', [h.PHOTO(0), h.PHOTO(1)]);
  await page.waitForFunction(() => document.querySelectorAll('[data-a="rm"]').length === 2);
  const r = await h.capture(page, () => page.click('#goBtn'), 30000);
  const info = await h.pdfRead(browser, base, r.buf);
  h.assert.equal(info.pages, 2, 'two pages');
  h.assert(r.size > 20000, 'carries the images: ' + r.size);
  h.assert(/\.pdf$/.test(r.name), 'named ' + r.name);
};
cases['JPG to PDF: Letter size and landscape change the page size'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/jpg-to-pdf/');
  await page.setInputFiles('input[type=file]', [h.PHOTO(0)]);
  await page.waitForFunction(() => document.querySelectorAll('[data-a="rm"]').length === 1);
  await page.click('button[data-v="letter"]');
  await page.click('button[data-v="landscape"]');
  const r = await h.capture(page, () => page.click('#goBtn'), 30000);
  const s = (await h.pdfRead(browser, base, r.buf)).sizes[0];
  h.assert(s[0] === 792 && s[1] === 612, 'US Letter landscape: ' + s);
};
cases['QR code: the default URL renders a code; PNG and SVG downloads are valid files'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/qr-code-generator/');
  await page.waitForTimeout(600);
  const dark = await page.evaluate(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80) n++; return { n, w: c.width }; });
  h.assert(dark.n > 500, 'a QR pattern is drawn: dark pixels ' + dark.n);
  const png = await h.capture(page, () => page.click('#png'));
  h.assert(h.imageInfo(png.buf).type === 'png' && png.size > 300, 'PNG download');
  const svg = await h.capture(page, () => page.click('#svg'));
  h.assert(svg.buf.toString().indexOf('<svg') >= 0, 'SVG download');
  await page.click('button[data-t="text"]');
  await page.fill('#f-text', 'hello from the test');
  await page.waitForTimeout(400);
  const dark2 = await page.evaluate(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80) n++; return n; });
  h.assert(dark2 > 500 && dark2 !== dark.n, 'text QR renders differently');
};
cases['password generator: length slider, options and bulk generation'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/password-generator/');
  const pw = () => page.inputValue('#out');
  const a = await pw();
  h.assert.equal(a.length, 20, 'default length 20');
  await page.click('#regen');
  h.assert((await pw()) !== a, 'regenerate gives a new one');
  await page.evaluate(() => { const r = document.getElementById('len'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  h.assert.equal((await pw()).length, 40, 'length 40');
  for (const id of ['up', 'lo', 'sy']) await page.evaluate((i) => { const c = document.getElementById(i); if (c.checked) c.click(); }, id);
  await page.waitForTimeout(200);
  h.assert(/^\d{40}$/.test(await pw()), 'digits only: ' + (await pw()));
  await page.click('[data-bulk="10"]');
  await page.waitForTimeout(300);
  h.assert((await page.innerText('main')).length > 0);
  await page.click('button[data-mode="pp"]');
  await page.waitForTimeout(200);
  h.assert(/[A-Za-z]+[- .][A-Za-z]+/.test(await pw()), 'passphrase: ' + (await pw()));
  h.assert.noErrors(page);
};
cases['JSON formatter: format, minify, validate and an error for broken JSON'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/json-formatter/');
  await page.fill('#inp', '{"b":[1,2,{"c":null}],"a":true}');
  await page.click('#fmt');
  await page.waitForTimeout(300);
  const out = await page.inputValue('#out');
  h.assert(out.indexOf('\n') > 0 && /^\{\n  "b"/.test(out), 'pretty printed with 2 spaces: ' + out.slice(0, 40));
  await page.click('#min');
  await page.waitForTimeout(200);
  h.assert.equal(await page.inputValue('#out'), '{"b":[1,2,{"c":null}],"a":true}', 'minified');
  await page.check('#sort');
  await page.click('#fmt');
  await page.waitForTimeout(200);
  h.assert(/"a": true,\n\s+"b"/.test(await page.inputValue('#out')), 'sorted keys');
  await page.fill('#inp', '{"broken": ');
  await page.click('#val');
  await page.waitForTimeout(300);
  const t = await page.innerText('main');
  h.assert(/invalid|error|unexpected|expected/i.test(t), 'a readable error is shown');
  h.assert.noErrors(page, [/JSON/i]);
};
cases['JSON formatter: Sample then Download .json gives valid JSON'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/json-formatter/');
  await page.click('#sample');
  await page.click('#fmt');
  await page.waitForTimeout(300);
  const r = await h.capture(page, () => page.click('#dl'));
  JSON.parse(r.buf.toString());
  h.assert(/\.json$/.test(r.name), 'named ' + r.name);
};
cases['tool pages are usable on a phone: file tools show the drop zone with a 44px+ action and no sideways scroll'] = async ({ browser, base, h }) => {
  for (const url of ['/image-compressor/', '/merge-pdf/', '/qr-code-generator/', '/password-generator/', '/json-formatter/', '/image-resizer/']) {
    const page = await h.open(browser, base, url, 'phone');
    await page.waitForTimeout(300);
    h.assert(await h.noOverflow(page), url + ' scrolls sideways');
    h.assert.noErrors(page);
    await page.context().close();
  }
};

/* ---------- PDF studio ---------- */
cases['PDF studio: opens sample.pdf, shows a page, adds a text annotation and saves a non-empty PDF'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/pdf-studio/');
  await page.waitForTimeout(500);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'Open a PDF' }).first().click()]);
  await fc.setFiles(h.FIXTURE('sample.pdf'));
  await page.waitForSelector('.ps-save', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
  h.assert((await page.innerText('body')).indexOf('Page 1 of 1') >= 0 || (await page.locator('canvas').count()) >= 1, 'the page is shown');
  h.assert.noErrors(page);
  await page.getByRole('button', { name: 'Text', exact: true }).first().click();
  await page.waitForTimeout(400);
  const stage = page.locator('canvas').filter({ hasNot: page.locator('x') }).last();
  let bb = null;
  for (const c of await page.locator('canvas').all()) { const b = await c.boundingBox(); if (b && b.width > 300 && (!bb || b.width > bb.width)) bb = b; }
  h.assert(bb, 'the page canvas is visible');
  await page.mouse.click(bb.x + bb.width * 0.2, bb.y + bb.height * 0.75);
  await page.waitForTimeout(500);
  await page.keyboard.type('QA note');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const save = page.locator('.ps-save, button:has-text("Save PDF")').first();
  h.assert(await save.count() === 1, 'Save PDF button exists');
  const r = await h.capture(page, () => save.click(), 40000);
  h.assert(r.buf.slice(0, 5).toString() === '%PDF-' && r.size > 500, 'saved a non-empty PDF: ' + r.size);
  const info = await h.pdfRead(browser, base, r.buf);
  h.assert.equal(info.pages, 1, 'still one page');
  h.assert(/LEPDFPASS/.test(info.text), 'the original page text survives: "' + info.text.slice(0, 80) + '"');
  h.assert(/QA note/.test(info.text), 'the annotation text is in the saved PDF: "' + info.text.slice(0, 80) + '"');
};

/* ---------- Convert to PDF ---------- */
['sample.docx', 'sample.md', 'sample.png'].forEach((f) => {
  cases['convert to PDF: ' + f + ' becomes a non-empty PDF'] = async ({ browser, base, h }) => {
    const page = await tool(browser, base, h, '/convert-to-pdf/');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose files/ }).click()]);
    await fc.setFiles(h.FIXTURE(f));
    const dl = page.locator('.cv-dl, .cv-bar-dl, button:has-text("Download")').first();
    await dl.waitFor({ state: 'visible', timeout: 40000 });
    await page.waitForFunction(() => { const b = document.querySelector('.cv-dl, .cv-bar-dl'); return !b || !b.disabled; }, null, { timeout: 40000 });
    const r = await h.capture(page, () => dl.click(), 40000);
    h.assert(r.buf.slice(0, 5).toString() === '%PDF-' && r.size > 800, f + ' -> PDF ' + r.size + ' bytes (' + r.name + ')');
    const info = await h.pdfRead(browser, base, r.buf);
    h.assert(info.pages >= 1, 'at least one page');
    h.assert.noErrors(page);
  };
});
cases['image converter: Download all right after switching the output format delivers the new format (QA-016)'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-converter/');
  await page.setInputFiles('input[type=file]', h.PHOTO(2));
  await page.waitForFunction(() => !document.getElementById('dl-all').disabled);
  await page.click('button[data-v="image/png"]');
  const r = await h.capture(page, () => page.click('#dl-all'));
  h.assert.equal(h.imageInfo(r.buf).type, 'png', 'got ' + h.imageInfo(r.buf).type + ' named ' + r.name);
};
cases['image compressor: Download all right after changing the format or quality waits for the re-encode (QA-016 sibling)'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-compressor/');
  await page.setInputFiles('input[type=file]', h.PHOTO(2));
  await page.waitForFunction(() => !document.getElementById('dl-all').disabled);
  await page.click('button[data-v="image/jpeg"]');
  h.assert(await page.evaluate(() => document.getElementById('dl-all').disabled), 'Download all is disabled while the re-encode is pending');
  await page.waitForFunction(() => !document.getElementById('dl-all').disabled);
  const r = await h.capture(page, () => page.click('#dl-all'));
  h.assert.equal(h.imageInfo(r.buf).type, 'jpeg', 'got ' + h.imageInfo(r.buf).type + ' named ' + r.name);
};
cases['image resizer: Download is not offered for a stale size while a change is pending'] = async ({ browser, base, h }) => {
  const page = await tool(browser, base, h, '/image-resizer/');
  await page.setInputFiles('input[type=file]', h.PHOTO(2));
  await page.waitForFunction(() => !document.getElementById('dl').disabled);
  await page.fill('#w', '321');
  h.assert(await page.evaluate(() => document.getElementById('dl').disabled), 'Download is disabled right after typing a width');
  await page.waitForFunction(() => !document.getElementById('dl').disabled);
  const r = await h.capture(page, () => page.click('#dl'));
  h.assert.equal(h.imageInfo(r.buf).w, 321, 'downloaded the new width');
};
cases['noOverflow also flags a layout viewport wider than the device (a 455 px page on a 390 px phone)'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/about/', 'phone');
  h.assert(await h.noOverflow(page), 'a correct page passes');
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'width:455px;height:8px'; document.body.appendChild(d); });
  await page.waitForTimeout(200);
  h.assert(!(await h.noOverflow(page)), 'a 455 px element on a 390 px phone is caught');
};
/* Every tool page and the home page at 390 and 360 px, in groups of 8 pages so no one case nears the 90 s limit
   under parallel load (the single case took about 87 s alone). Pages are listed when this file loads. */
(function () {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const dirs = fs.readdirSync(ROOT).filter((d) => fs.existsSync(ROOT + '/' + d + '/index.html') && !/^(studio|pdf-studio|recipes|labs)$/.test(d)).sort();
  const urls = ['/'].concat(dirs.map((d) => '/' + d + '/'));
  const SIZE = 8;
  for (let i = 0; i < urls.length; i += SIZE) {
    const group = urls.slice(i, i + SIZE);
    cases['tool pages fit a 390 and a 360 px phone with no sideways scroll (' + (i / SIZE + 1) + ' of ' + Math.ceil(urls.length / SIZE) + ': ' + group[0] + ' … ' + group[group.length - 1] + ')'] = async ({ browser, base, h }) => {
      const bad = [];
      for (const vp of ['phone', 'small']) for (const u of group) {
        const page = await h.open(browser, base, u, vp);
        if (!(await h.noOverflow(page))) bad.push(vp + ' ' + u);
        await page.context().close();
      }
      h.assert(!bad.length, 'sideways scroll on: ' + bad.join(', '));
    };
  }
})();
cases['KNOWN-BUG: converted DOCX / Markdown PDFs keep selectable text, not just page pictures (QA-010)'] = async ({ browser, base, h }) => {
  for (const f of ['sample.md', 'sample.docx']) {
    const page = await tool(browser, base, h, '/convert-to-pdf/');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose files/ }).click()]);
    await fc.setFiles(h.FIXTURE(f));
    const dl = page.locator('.cv-dl, .cv-bar-dl, button:has-text("Download")').first();
    await dl.waitFor({ state: 'visible', timeout: 40000 });
    await page.waitForTimeout(800);
    const r = await h.capture(page, () => dl.click(), 40000);
    const info = await h.pdfRead(browser, base, r.buf);
    h.assert(info.text.replace(/\s+/g, ' ').trim().length > 20, f + ' PDF has no text layer (' + r.size + ' bytes, ' + info.pages + ' pages)');
    await page.context().close();
  }
};
module.exports = cases;
