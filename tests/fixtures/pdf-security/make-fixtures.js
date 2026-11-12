/* Writes the PDF security fixtures to disk for manual checks: node tests/fixtures/pdf-security/make-fixtures.js [outDir]
   The tests build the same files in the page from fixtures.js, so nothing binary is committed. */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('../../lib/harness');

(async () => {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
  fs.mkdirSync(out, { recursive: true });
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const page = await h.open(browser, base, '/pdf-studio/');
  await page.addScriptTag({ url: base + '/tests/fixtures/pdf-security/fixtures.js' });
  const files = await page.evaluate(async () => {
    await LE.pdf.ready();
    const all = await SecFixtures.all();
    const hostile = await SecFixtures.hostile();
    Object.keys(hostile).forEach((k) => { all['hostile-' + k] = hostile[k]; });
    const res = {};
    Object.keys(all).forEach((k) => { let s = ''; const b = all[k]; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); res[k] = btoa(s); });
    return res;
  });
  Object.keys(files).forEach((k) => {
    const file = path.join(out, k + '.pdf');
    fs.writeFileSync(file, Buffer.from(files[k], 'base64'));
    console.log(file, fs.statSync(file).size + ' bytes');
  });
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
