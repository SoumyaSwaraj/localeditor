/* PDF bulk and protection tools (docs/ROADMAP.md D5, D7, D8, D12, D13): LE.pdfBulk and the studio's Bulk & protect area.
   Fixtures are built by tests/fixtures/pdf-bulk/make-fixtures.js. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FX = path.join(__dirname, 'fixtures', 'pdf-bulk');

/* Opens the PDF studio with helpers: __fx(name) → Uint8Array, __text(bytes, pw) → [page text], __file(name) → File. */
async function studio(h, browser, base, vp) {
  const page = await h.open(browser, base, '/pdf-studio/', vp || 'desktop');
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.type() + ': ' + m.text()));
  await page.waitForFunction(() => window.LE && LE.pdfBulk && window.PS && PS.bulk);
  await page.evaluate(() => {
    window.__fx = async (n) => new Uint8Array(await (await fetch('/tests/fixtures/pdf-bulk/' + n)).arrayBuffer());
    window.__file = async (n, type) => new File([await window.__fx(n)], n, { type: type || '' });
    window.__text = async (bytes, pw) => {
      await LE.pdf.ready();
      const d = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, password: pw }).promise;
      const out = [];
      for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); const tc = await p.getTextContent(); out.push(tc.items.map((x) => x.str).join(' ')); p.cleanup(); }
      d.destroy();
      return out;
    };
    window.__opens = async (bytes, pw) => {
      try { const d = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, password: pw }).promise; const n = d.numPages; d.destroy(); return 'ok:' + n; }
      catch (e) { return e.name + ':' + e.code; }
    };
    window.__b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  });
  return page;
}

function readStoredZip(buf) {
  const out = {};
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + xlen;
    out[name] = buf.slice(start, start + size);
    i = start + size;
  }
  return out;
}

function have(cmd) { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (e) { return false; } }
function tmpFile(name, bytes) { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdfbulk-')), name); fs.writeFileSync(p, bytes); return p; }

async function pick(page, trigger, names) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await fc.setFiles(names.map((n) => path.join(FX, n)));
}
async function downloadOf(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(p) };
}
function noSecrets(h, page, secrets) {
  const logs = page.logs.join('\n');
  secrets.forEach((s) => h.assert(logs.indexOf(s) < 0, 'a password appeared in console output'));
}
async function storageHas(page, secrets) {
  return page.evaluate((secrets) => {
    const all = [];
    for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) { const k = st.key(i); all.push(k + '=' + st.getItem(k)); }
    const blob = all.join('\n');
    return secrets.filter((s) => blob.indexOf(s) >= 0);
  }, secrets);
}

module.exports = {
  'protect: AES-256 file needs the password in pdf.js; unlock needs the right one': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const PW = 'quartz-meadow-41-lantern';
    const r = await page.evaluate(async (PW) => {
      const B = LE.pdfBulk;
      const src = await __fx('form-template.pdf');
      const before = await __text(src);
      const enc = await B.protect(src, { userPassword: PW, permissions: { printing: false, copying: false } });
      const info = await B.encryptionInfo(enc);
      const raw = new TextDecoder('latin1').decode(enc);
      const out = { info, plainLeak: raw.indexOf('Employee name') >= 0 || raw.indexOf(PW) >= 0 };
      out.noPw = await __opens(enc);
      out.wrongPw = await __opens(enc, 'not-it');
      out.rightPw = await __opens(enc, PW);
      out.sameText = JSON.stringify(await __text(enc, PW)) === JSON.stringify(before);
      try { await B.unlock(enc, 'not-it'); out.unlockWrong = 'unlocked!'; } catch (e) { out.unlockWrong = e.code + '|' + e.reason + '|' + e.message; }
      const un = await B.unlock(enc, PW);
      out.unInfo = await B.encryptionInfo(un);
      out.unRaw = /\/Encrypt\b/.test(new TextDecoder('latin1').decode(un));
      out.unOpens = await __opens(un);
      out.unSame = JSON.stringify(await __text(un)) === JSON.stringify(before);
      const a128 = await B.protect(src, { userPassword: PW, algorithm: 'AES-128' });
      out.a128 = await B.encryptionInfo(a128);
      out.a128opens = await __opens(a128, PW);
      try { await B.unlock(src, PW); } catch (e) { out.notEnc = e.code; }
      window.__enc = __b64(enc);
      return out;
    }, PW);
    h.assert.equal(r.info.encrypted, true, 'encrypted');
    h.assert.equal(r.info.V, 5, 'V 5');
    h.assert.equal(r.info.R, 6, 'R 6');
    h.assert.equal(r.info.cfm, 'AESV3', 'AESV3 crypt filter');
    h.assert.equal(r.info.length, 256, 'key length 256');
    h.assert.equal(r.info.algorithm, 'AES-256');
    h.assert.equal(r.info.permissions.printing, false, 'printing off');
    h.assert.equal(r.info.permissions.copying, false, 'copying off');
    h.assert(!r.plainLeak, 'plain text or password visible in the encrypted bytes');
    h.assert.equal(r.noPw, 'PasswordException:1', 'pdf.js asks for a password');
    h.assert.equal(r.wrongPw, 'PasswordException:2', 'pdf.js rejects a wrong password');
    h.assert.equal(r.rightPw, 'ok:1', 'pdf.js opens with the password');
    h.assert(r.sameText, 'text survives protection');
    h.assert(/^password\|incorrect\|That password did not open/.test(r.unlockWrong), 'wrong password message: ' + r.unlockWrong);
    h.assert.equal(r.unInfo.encrypted, false, 'unlocked copy is not encrypted');
    h.assert(!r.unRaw, 'no /Encrypt left in the unlocked copy');
    h.assert.equal(r.unOpens, 'ok:1');
    h.assert(r.unSame, 'unlocked text matches');
    h.assert.equal(r.a128.V, 4); h.assert.equal(r.a128.cfm, 'AESV2'); h.assert.equal(r.a128opens, 'ok:1');
    h.assert.equal(r.notEnc, 'not-encrypted');
    /* independent readers, when the build machine has them */
    const enc = Buffer.from(await page.evaluate(() => window.__enc), 'base64');
    const f = tmpFile('protected.pdf', enc);
    if (have('pdfinfo')) {
      let failed = false;
      try { execFileSync('pdfinfo', [f], { stdio: 'pipe' }); } catch (e) { failed = true; }
      h.assert(failed, 'poppler opened the file without a password');
      const info = execFileSync('pdfinfo', ['-upw', PW, f]).toString();
      h.assert(/Encrypted:\s+yes .*AES-256/.test(info), 'poppler reports AES-256: ' + info);
    }
    if (have('python3')) {
      let out = '';
      try { out = execFileSync('python3', ['-I', '-c', 'import sys,pypdf\nr=pypdf.PdfReader(sys.argv[1])\nprint(int(r.decrypt("nope")), int(r.decrypt(sys.argv[2])), r.pages[0].extract_text()[:40].replace(chr(10)," "))', f, PW], { stdio: 'pipe' }).toString(); } catch (e) { out = 'skip'; }
      if (out !== 'skip') h.assert(/^0 1 ACME/.test(out.trim()), 'pypdf: ' + out);
    }
    noSecrets(h, page, [PW]);
    h.assert.noErrors(page);
  },

  'protect UI: suggest, strength hint, protect and unlock, nothing stored': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base, 'phone');
    await page.click('#ps-rail [data-panel="bulk"]');
    await page.click('.pb-job[data-job="protect"]');
    await pick(page, () => page.click('.pb-work .pb-source .btn:not(.btn-ghost)'), ['form-template.pdf']);
    h.assert(await page.isDisabled('.pb-go'), 'protect is disabled without a password');
    await page.fill('.pb-pw >> nth=0 >> input', '19900423');
    const weak = await page.textContent('.pb-meter-label');
    h.assert(/weak/i.test(weak), 'a date reads as weak: ' + weak);
    h.assert(/date/i.test(await page.textContent('.pb-meter-hint')), 'date hint shown');
    await page.click('.pb-suggest');
    const pw = await page.inputValue('.pb-pw >> nth=0 >> input');
    h.assert(pw.split('-').length === 6, 'six-word passphrase: ' + pw);
    h.assert(/strong/i.test(await page.textContent('.pb-meter-label')), 'passphrase reads as strong');
    h.assert(await h.noOverflow(page), 'no sideways scroll on phone');
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result');
    const dl = await downloadOf(page, () => page.click('.pb-go'));
    h.assert.equal(dl.name, 'form-template-protected.pdf');
    const opened = await page.evaluate(async ([b64, pw]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return [await __opens(bytes), await __opens(bytes, pw)];
    }, [dl.bytes.toString('base64'), pw]);
    h.assert.equal(opened[0], 'PasswordException:1');
    h.assert.equal(opened[1], 'ok:1');
    /* unlock with a wrong password, then the right one */
    const f = tmpFile('locked.pdf', dl.bytes);
    await page.click('.pb-work .ps-seg button[data-v="remove"]');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.pb-work .pb-source .btn:not(.btn-ghost)')]);
    await fc.setFiles([f]);
    await page.click('.pb-file-x >> nth=0').catch(() => {});
    await page.fill('.pb-pw:not([hidden]) input', 'wrong-one');
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result.is-bad');
    h.assert(/did not open/.test(await page.textContent('.pb-result.is-bad')), 'wrong password is explained');
    await page.fill('.pb-pw:not([hidden]) input', pw);
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result:not(.is-bad)');
    const un = await downloadOf(page, () => page.click('.pb-go'));
    h.assert(/unlocked\.pdf$/.test(un.name), un.name);
    h.assert(un.bytes.toString('latin1').indexOf('/Encrypt') < 0, 'unlocked file has no /Encrypt');
    await page.click('.pb-close');
    h.assert.equal(await page.evaluate(() => [...document.querySelectorAll('.pb-work input[type="password"]')].filter((i) => i.value).length), 0, 'password fields cleared on close');
    h.assert.equal((await storageHas(page, [pw])).length, 0, 'password found in web storage');
    noSecrets(h, page, [pw]);
    h.assert.noErrors(page);
  },

  'mail-merge: {{placeholders}}, per-row passwords, names and summary': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const table = await B.parseTable(await (await fetch('/tests/fixtures/pdf-bulk/data.csv')).text());
      const plan = await B.analyzeTemplate(await __fx('placeholder-template.pdf'));
      const clean = (await __text(plan.cleanBytes))[0];
      const mapping = B.autoMap(plan.keys, table.columns);
      const res = await B.mailMerge(plan, table.rows, { mapping, namePattern: 'Payslip-{{name}}-{{month}}', password: { mode: 'pattern', pattern: '{{Date of birth|DDMMYYYY}}' } });
      const checks = [];
      for (let i = 0; i < res.files.length; i++) {
        const row = table.rows[i];
        const dob = row['Date of birth'].split('-');
        const pw = dob[2] + dob[1] + dob[0];
        checks.push({ name: res.files[i].name, noPw: await __opens(res.files[i].bytes), text: (await __text(res.files[i].bytes, pw))[0], row, pw });
      }
      return { kind: plan.kind, keys: plan.keys, slots: plan.slots.map((s) => [s.removable, !!s.cover]), clean, mapping, checks, summary: res.summary, report: res.report };
    });
    h.assert.equal(r.kind, 'text');
    h.assert.equal(r.keys.join(','), 'name,employee_id,month,net_pay');
    h.assert(r.slots.every((s) => s[0] && !s[1]), 'all placeholders lifted out of the page text, none covered');
    h.assert(r.clean.indexOf('{{') < 0, 'placeholders removed from the template text: ' + r.clean);
    h.assert.equal(r.mapping.net_pay, 'Net pay');
    h.assert.equal(r.checks.length, 12);
    r.checks.forEach((c) => {
      h.assert.equal(c.name, 'Payslip-' + c.row.Name + '-November 2026.pdf');
      h.assert.equal(c.noPw, 'PasswordException:1', c.name + ' opens without a password');
      ['Name', 'Employee ID', 'Net pay'].forEach((k) => h.assert(c.text.indexOf(c.row[k]) >= 0, c.name + ' lacks ' + k + ': ' + c.text));
      h.assert(c.text.indexOf('Dear ' + c.row.Name + ', thank you for your work in November 2026.') >= 0, 'inline placeholder sentence: ' + c.text);
      h.assert(c.text.indexOf('{{') < 0, 'no placeholder left');
    });
    const lines = r.summary.trim().split(/\r?\n/);
    h.assert.equal(lines.length, 13, 'summary has a header and 12 rows');
    h.assert.equal(lines[0], 'row,file,password_protected,watermarked,bytes');
    r.checks.forEach((c) => h.assert(r.summary.indexOf(c.pw) < 0 && r.summary.indexOf(c.row['Date of birth']) < 0, 'summary must not contain passwords'));
    h.assert.equal(r.report.protected, 12);
    noSecrets(h, page, r.checks.map((c) => c.pw));
    h.assert.noErrors(page);
  },

  'mail-merge: form fields from XLSX, flattened; 200 rows run quickly': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const table = await B.parseTable(await __file('data.xlsx'));
      const plan = await B.analyzeTemplate(await __fx('form-template.pdf'));
      const mapping = B.autoMap(plan.fields.map((f) => f.name), table.columns);
      const res = await B.mailMerge(plan, table.rows, { mapping, flatten: true, namePattern: '{{Employee ID}} {{Name}}' });
      const fieldsLeft = (await PDFLib.PDFDocument.load(res.files[0].bytes)).getForm().getFields().length;
      const texts = [];
      for (const f of res.files) texts.push((await __text(f.bytes))[0]);
      const many = [];
      for (let i = 0; i < 200; i++) many.push({ Name: 'Person ' + i, 'Employee ID': String(20000 + i), Month: 'November 2026', 'Net pay': (1000 + i) + '.00' });
      const tpl = await B.analyzeTemplate(await __fx('placeholder-template.pdf'));
      const t0 = performance.now();
      const big = await B.mailMerge(tpl, many, { namePattern: '{{Name}}' });
      const ms = performance.now() - t0;
      const zipped = B.zip(big.files, [{ name: 'summary.csv', text: big.summary }]);
      return { sheets: table.sheets, cols: table.columns, rows: table.rows.length, dob: table.rows[0]['Date of birth'], fields: plan.fields.map((f) => f.type), names: res.files.map((f) => f.name), fieldsLeft, texts, ms, bigCount: big.files.length, bigUnique: new Set(big.files.map((f) => f.name)).size, zipSize: zipped.size, lastText: (await __text(big.files[199].bytes))[0] };
    });
    h.assert.equal(r.sheets.join('|'), 'November|Notes');
    h.assert.equal(r.rows, 5);
    h.assert.equal(r.dob, '1990-04-23', 'Excel dates become ISO dates');
    h.assert.equal(r.fields.join(','), 'text,text,text,text,checkbox');
    h.assert.equal(r.names[3], '10004 Łukasz Nowak.pdf');
    h.assert.equal(r.fieldsLeft, 0, 'flattened');
    h.assert(r.texts[3].indexOf('Łukasz Nowak') >= 0 && r.texts[3].indexOf('2,760.00') >= 0, 'values in the flattened page: ' + r.texts[3]);
    h.assert.equal(r.bigCount, 200);
    h.assert.equal(r.bigUnique, 200);
    h.assert(r.ms < 30000, '200 rows took ' + Math.round(r.ms) + ' ms');
    h.assert(r.lastText.indexOf('Person 199') >= 0 && r.lastText.indexOf('20199') >= 0, 'row 200 values');
    h.assert.noErrors(page);
  },

  'mail-merge: bad rows are reported before anything runs': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const t = await B.parseTable(await __file('bad-data.csv'));
      const plan = await B.analyzeTemplate(await __fx('placeholder-template.pdf'));
      const mapping = B.autoMap(plan.keys, t.columns);
      const v = B.validateRows(t.rows, { targets: plan.keys, mapping, namePattern: '{{Name}}', password: { mode: 'column', column: 'Date of birth' } });
      let thrown = null;
      try { await B.mailMerge(plan, t.rows, { mapping, namePattern: '{{Name}}', password: { mode: 'column', column: 'Date of birth' } }); } catch (e) { thrown = e.code; }
      const v2 = B.validateRows(t.rows, { targets: plan.keys, mapping, namePattern: '{{Nmae}}' });
      return { v, thrown, v2 };
    });
    h.assert(!r.v.ok, 'not ok');
    h.assert(r.v.errors.some((e) => e.row === 4 && /no password/.test(e.message)), 'row 4 missing password: ' + JSON.stringify(r.v.errors));
    h.assert(r.v.warnings.some((w) => w.row === 3 && /Net pay/.test(w.message)), 'row 3 empty net pay');
    h.assert(r.v.warnings.some((w) => w.row === 2 && /already used/.test(w.message)), 'row 2 duplicate name');
    h.assert.equal(r.v.names[1], 'Priya Sharma (2).pdf', 'duplicate names are de-duplicated');
    h.assert.equal(r.thrown, 'invalid', 'merge refuses to run');
    h.assert(r.v2.errors.some((e) => /not a column/.test(e.message)), 'unknown column in the name pattern');
    h.assert.noErrors(page);
  },

  'mail-merge UI on a phone: template, data, passwords, zip with summary.csv': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base, 'phone');
    await page.click('#ps-rail [data-panel="bulk"]');
    await page.click('.pb-job[data-job="merge"]');
    await pick(page, () => page.click('.pb-work .pb-source .btn:not(.btn-ghost)'), ['placeholder-template.pdf']);
    await page.waitForSelector('.pb-info .pb-ok');
    await pick(page, () => page.click('text=Choose a spreadsheet'), ['data.csv']);
    await page.waitForSelector('.pb-map-row');
    h.assert.equal(await page.$$eval('.pb-map select', (s) => s.filter((x) => x.value).length), 4, 'all four placeholders matched');
    await page.click('.pb-work .ps-seg button[data-v="pattern"]');
    h.assert.equal(await page.inputValue('#pb-merge-pwpat'), '{{Date of birth|DDMMYYYY}}');
    await page.fill('#pb-merge-name', 'Payslip-{{Name}}');
    await page.waitForSelector('.pb-preview-stage canvas');
    h.assert(await h.noOverflow(page), 'no sideways scroll');
    h.assert(!(await page.isDisabled('.pb-go')), 'create enabled');
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result', { timeout: 60000 });
    const dl = await downloadOf(page, () => page.click('.pb-go'));
    h.assert(/\.zip$/.test(dl.name), dl.name);
    const files = readStoredZip(dl.bytes);
    const names = Object.keys(files);
    h.assert.equal(names.length, 13, 'twelve PDFs and summary.csv: ' + names.join(', '));
    h.assert(names.indexOf('Payslip-Zoë Müller.pdf') >= 0, 'unicode file name kept');
    const summary = files['summary.csv'].toString('utf8');
    h.assert(summary.indexOf('23041990') < 0, 'no password in summary');
    h.assert(files['Payslip-Priya Sharma.pdf'].toString('latin1').indexOf('/Encrypt') > 0, 'per-row file is encrypted');
    h.assert.equal((await storageHas(page, ['23041990', '02111985'])).length, 0, 'password in web storage');
    noSecrets(h, page, ['23041990', '02111985']);
    h.assert.noErrors(page);
  },

  'mail-merge from studio text boxes: the open document is the template': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await pick(page, () => page.click('.ps-dropzone'), ['form-template.pdf']);
    await page.waitForFunction(() => PS.S.pages.length > 0);
    await page.evaluate(() => {
      const r = PS.S.pages[0];
      r.scene = r.scene || { v: 1, width: 595.28, height: 841.89, layers: [] };
      r.scene.layers.push({ id: 'tx1', type: 'text', name: 'Greeting', text: 'Dear {{Name}}, your ID is {{Employee ID}}.', x: 60, y: 420, w: 470, h: 40, size: 18, font: 'Lora', weight: 700, color: '#1D4ED8', align: 'center', lineHeight: 1.2, rotation: 0, opacity: 1, visible: true });
    });
    await page.click('#ps-rail [data-panel="bulk"]');
    await page.click('.pb-job[data-job="merge"]');
    await page.waitForSelector('.pb-info .pb-ok');
    h.assert(/2 placeholders in your studio text boxes/.test(await page.textContent('.pb-info')), 'studio placeholders found');
    await pick(page, () => page.click('text=Choose a spreadsheet'), ['data.csv']);
    await page.waitForSelector('.pb-preview-stage canvas', { timeout: 30000 });
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result', { timeout: 60000 });
    const dl = await downloadOf(page, () => page.click('.pb-go'));
    const files = readStoredZip(dl.bytes);
    const name = Object.keys(files).filter((n) => /Łukasz/.test(n))[0];
    h.assert(name, 'row file present: ' + Object.keys(files).join(', '));
    const r = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const d = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const p = await d.getPage(1);
      const tc = await p.getTextContent();
      const it = tc.items.filter((x) => /Dear/.test(x.str))[0];
      const out = { text: tc.items.map((x) => x.str).join(' '), x: it && it.transform[4], w: it && it.width, font: it && tc.styles[it.fontName].fontFamily };
      d.destroy();
      return out;
    }, files[name].toString('base64'));
    h.assert(r.text.indexOf('Dear Łukasz Nowak, your ID is 10004.') >= 0, r.text);
    h.assert(Math.abs((r.x + r.w / 2) - (60 + 235)) < 6, 'still centred in its box: ' + r.x + ' + ' + r.w);
    h.assert.equal(await page.evaluate(() => PS.S.pages[0].scene.layers[0].text), 'Dear {{Name}}, your ID is {{Employee ID}}.', 'the studio document is not changed');
    h.assert.noErrors(page);
  },

  'split by text: groups, names, page counts; every N, bookmarks, size': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const pay = await __fx('payslips-30.pdf');
      const pl = await B.pageLines(pay, 0);
      const li = pl.lines.findIndex((l) => /^Employee ID/.test(l.text));
      const rule = B.ruleFromClick(pl, li, 0);
      const nameLine = pl.lines.findIndex((l) => /^Name/.test(l.text));
      const rule2 = B.ruleFromClick(pl, nameLine, 1);
      const plan = await B.splitPlan(pay, rule, { fileName: 'payslips-30.pdf', namePattern: 'Payslip {{value}}' });
      const files = await B.splitApply(pay, plan.groups);
      const counts = [];
      for (const f of files.files) counts.push((await __opens(f.bytes)));
      const byName = await B.splitPlan(pay, rule2, {});
      const every = await B.splitPlan(pay, { mode: 'every', n: 7 }, { fileName: 'payslips-30.pdf', namePattern: '{{file}}-{{n}}' });
      const marks = await B.splitPlan(pay, { mode: 'bookmarks' }, {});
      const size = await B.splitPlan(pay, { mode: 'size', maxBytes: 60 * 1024 }, {});
      const blank = await B.splitPlan(pay, { mode: 'blank' }, {});
      return { rule, rule2, groups: plan.groups.map((g) => [g.name, g.pages.length]), noText: plan.noText, warn: plan.warnings, counts, summary: files.summary, byName: byName.groups.map((g) => g.name), every: every.groups.map((g) => [g.name, g.pages.length]), marks: marks.groups.map((g) => [g.name, g.pages[0], g.pages.length]), size: size.groups.length, blank: blank.groups.length, blankWarn: blank.warnings };
    });
    h.assert.equal(JSON.stringify(r.rule), JSON.stringify({ mode: 'text', label: 'Employee ID:', where: 'after', value: '10001' }));
    h.assert.equal(r.rule2.label, 'Name:');
    const want = [2, 3, 2, 2, 3, 2, 3, 2, 3, 2, 3, 3];
    h.assert.equal(r.groups.length, 12);
    r.groups.forEach((g, i) => { h.assert.equal(g[0], 'Payslip ' + (10001 + i) + '.pdf'); h.assert.equal(g[1], want[i], g[0]); });
    h.assert.equal(JSON.stringify(r.noText), '[8]', 'page 9 has no text layer');
    h.assert(r.warn.some((w) => /no text layer/.test(w) && /9/.test(w)), 'scanned page reported');
    h.assert.equal(r.counts.join(','), want.map((n) => 'ok:' + n).join(','), 'files have the right page counts');
    h.assert(/^file,value,pages,page_count/.test(r.summary), 'split summary');
    h.assert.equal(r.byName[3], 'Łukasz Nowak.pdf', 'name rule');
    h.assert.equal(JSON.stringify(r.every), JSON.stringify([['payslips-30-01.pdf', 7], ['payslips-30-02.pdf', 7], ['payslips-30-03.pdf', 7], ['payslips-30-04.pdf', 7], ['payslips-30-05.pdf', 2]]));
    h.assert.equal(r.marks.length, 12);
    h.assert.equal(JSON.stringify(r.marks[1]), JSON.stringify(['Daniel Okafor.pdf', 2, 3]));
    h.assert(r.size >= 2, 'size mode makes several parts: ' + r.size);
    h.assert.equal(r.blank, 1);
    h.assert(r.blankWarn.some((w) => /No blank pages/.test(w)));
    h.assert.noErrors(page);
  },

  'split UI: click the value, fix the groups, download the zip': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    await page.evaluate(() => PS.bulk.open('split'));
    await pick(page, () => page.click('.pb-work .pb-source .btn:not(.btn-ghost)'), ['payslips-30.pdf']);
    await page.waitForSelector('.pb-hit');
    await page.click('.pb-hit[title="Employee ID: 10001"]');
    h.assert.equal(await page.inputValue('#pb-split-label'), 'Employee ID:');
    h.assert(/10001/.test(await page.textContent('.pb-valuehint')), 'value shown');
    await page.click('text=Find the parts');
    await page.waitForSelector('.pb-glist');
    h.assert.equal(await page.$$eval('.pb-g', (x) => x.length), 12);
    h.assert(/no text on 9/.test(await page.textContent('.pb-g >> nth=3')), 'scanned page flagged on its group');
    await page.click('.pb-g >> nth=1 >> text=Join with previous');
    h.assert.equal(await page.$$eval('.pb-g', (x) => x.length), 11);
    await page.fill('.pb-g >> nth=0 >> input', 'Priya and Daniel');
    await page.press('.pb-g >> nth=0 >> input', 'Tab');
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result');
    const dl = await downloadOf(page, () => page.click('.pb-go'));
    const files = readStoredZip(dl.bytes);
    h.assert.equal(Object.keys(files).length, 12, '11 files and summary.csv');
    h.assert(files['Priya and Daniel.pdf'], 'renamed part present: ' + Object.keys(files).join(', '));
    h.assert.noErrors(page);
  },

  'watermark copies: recipient on every page, distinct identifiers, summary': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const src = await __fx('payslips-30.pdf');
      const res = await B.watermarkCopies(src, ['Priya Sharma', 'Łukasz Nowak', 'Priya Sharma'], { fileName: 'payslips-30.pdf', style: 'tiled', date: '12 Nov 2026' });
      const out = [];
      for (const f of res.files) {
        const pages = await __text(f.bytes);
        const d = await pdfjsLib.getDocument({ data: f.bytes.slice(0), isEvalSupported: false }).promise;
        const meta = await d.getMetadata();
        d.destroy();
        out.push({ name: f.name, id: f.id, recipient: f.recipient, pages: pages.length, every: pages.every((t) => t.indexOf('issued to ' + f.recipient + ' — 12 Nov 2026') >= 0), mark: pages.every((t) => t.indexOf(f.id) >= 0), metaId: meta.info && meta.info.Custom && meta.info.Custom.LocalEditorCopyId });
      }
      const foot = await B.watermark(await __fx('placeholder-template.pdf'), 'Confidential — issued to Zoë', { style: 'footer' });
      return { out, summary: res.summary, foot: (await __text(foot))[0] };
    });
    h.assert.equal(r.out.length, 3);
    r.out.forEach((c) => {
      h.assert.equal(c.pages, 30);
      h.assert(c.every, c.name + ': recipient text on every page');
      h.assert(c.mark, c.name + ': tiny identifier on every page');
      h.assert(/^LE-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c.id), c.id);
      h.assert.equal(c.metaId, c.id, 'identifier in document metadata');
    });
    h.assert.equal(new Set(r.out.map((c) => c.id)).size, 3, 'distinct identifiers');
    h.assert.equal(r.out[2].name, 'payslips-30 - Priya Sharma (2).pdf', 'repeat recipient gets a distinct file');
    const lines = r.summary.trim().split(/\r?\n/);
    h.assert.equal(lines[0], 'recipient,file,identifier,password_protected');
    r.out.forEach((c, i) => h.assert(lines[i + 1].indexOf(c.id) > 0 && lines[i + 1].indexOf(c.recipient) === 0, 'summary maps ' + c.recipient));
    h.assert(r.foot.indexOf('Confidential — issued to Zoë') >= 0, 'footer style');
    h.assert.noErrors(page);
  },

  'compress: reaches a reachable target, keeps text, skips what it cannot do, is honest otherwise': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const r = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const src = await __fx('images-heavy.pdf');
      const before = await B.textSignature(src);
      const a = await B.compress(src, { targetBytes: 600 * 1024 });
      const aText = await B.textSignature(a.bytes);
      /* every page still renders */
      const d = await pdfjsLib.getDocument({ data: a.bytes.slice(0), isEvalSupported: false }).promise;
      let rendered = 0;
      for (let i = 1; i <= d.numPages; i++) {
        const p = await d.getPage(i); const vp = p.getViewport({ scale: 0.5 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; rendered++;
      }
      d.destroy();
      const b = await B.compress(src, { targetBytes: 30 * 1024 });
      const bText = await B.textSignature(b.bytes);
      const c = await B.compress(src, { targetBytes: 120 * 1024, allowRaster: true });
      const cText = await B.textSignature(c.bytes);
      const lossless = await B.compress(await __fx('payslips-30.pdf'), { preset: 'lossless', stripMetadata: true });
      const meta = await (await pdfjsLib.getDocument({ data: lossless.bytes.slice(0), isEvalSupported: false }).promise).getMetadata();
      return { orig: src.length, a: { len: a.bytes.length, rep: a.report }, sameA: aText === before, rendered, b: { len: b.bytes.length, rep: b.report }, sameB: bText === before, c: { len: c.bytes.length, rep: c.report }, cText, llTitle: meta.info.Title || '', llReached: lossless.report.reached };
    });
    h.assert(r.a.rep.reached && r.a.len <= 600 * 1024, 'reachable target met: ' + r.a.len);
    h.assert(r.a.len < r.orig / 2, 'meaningfully smaller');
    h.assert(r.sameA, 'pdf.js text identical after image compression');
    h.assert.equal(r.a.rep.textSelectable, true);
    h.assert.equal(r.a.rep.rasterized, false);
    h.assert(r.a.rep.images.recompressed >= 3, 'photos recompressed');
    h.assert.equal(r.a.rep.images.skipped['CMYK images'], 1, 'CMYK left alone');
    h.assert.equal(r.a.rep.images.skipped['images with transparency masks'], 1, 'masked image left alone');
    h.assert.equal(r.rendered, 4, 'every page re-opens and renders');
    h.assert.equal(r.b.rep.reached, false, 'tiny target honestly not reached');
    h.assert(r.b.rep.notes.some((n) => /pictures/.test(n)), 'says why: ' + r.b.rep.notes.join(' / '));
    h.assert(r.sameB, 'text still identical when the target is not reached');
    h.assert.equal(r.c.rep.rasterized, true, 'raster only when allowed');
    h.assert.equal(r.c.rep.textSelectable, false);
    h.assert.equal(r.cText.trim(), '', 'raster pages carry no text');
    h.assert.equal(r.llTitle, '', 'metadata removed when asked');
    h.assert(r.llReached, 'lossless preset always reached');
    h.assert.noErrors(page);
  },

  'cancel mid-job leaves nothing half-written': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base);
    const api = await page.evaluate(async () => {
      const B = LE.pdfBulk;
      const t = await B.parseTable(await (await fetch('/tests/fixtures/pdf-bulk/data.csv')).text());
      const plan = await B.analyzeTemplate(await __fx('placeholder-template.pdf'));
      let seen = 0, result = null, err = null;
      try { result = await B.mailMerge(plan, t.rows, { namePattern: '{{Name}}', onProgress: () => { seen++; }, isCancelled: () => seen > 3 }); }
      catch (e) { err = e; }
      return { cancelled: !!(err && err.cancelled), result: result === null, seen };
    });
    h.assert(api.cancelled && api.result, 'API rejects with cancelled and returns nothing');
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.evaluate(() => PS.bulk.open('merge'));
    await pick(page, () => page.click('.pb-work .pb-source .btn:not(.btn-ghost)'), ['placeholder-template.pdf']);
    await page.waitForSelector('.pb-info .pb-ok');
    await pick(page, () => page.click('text=Choose a spreadsheet'), ['data.csv']);
    await page.waitForSelector('.pb-map-row');
    await page.click('.pb-work .ps-seg button[data-v="pattern"]');
    await page.click('.pb-go');
    await page.waitForSelector('#ps-progress:not([hidden]) .ps-prog-cancel:not([hidden])');
    await page.waitForFunction(() => /Row [2-9]/.test(document.querySelector('.ps-prog-sub').textContent || ''), null, { timeout: 20000 });
    await page.click('.ps-prog-cancel');
    await page.waitForFunction(() => /Cancelled\. Nothing was saved\./.test(document.querySelector('.pb-foot-msg').textContent));
    await page.waitForTimeout(400);
    h.assert.equal(await page.$$eval('.pb-result', (x) => x.length), 0, 'no result shown');
    h.assert.equal(downloads, 0, 'nothing downloaded');
    h.assert(await page.isHidden('#ps-progress'), 'progress closed');
    h.assert.noErrors(page);
  },

  'no cross-origin requests; every job fits a 360px phone': async ({ browser, base, h }) => {
    const page = await studio(h, browser, base, 'small');
    const foreign = [];
    page.on('request', (req) => { const u = req.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) foreign.push(u); });
    await page.click('#ps-rail [data-panel="bulk"]');
    h.assert(await h.noOverflow(page), 'panel fits');
    for (const job of ['protect', 'merge', 'split', 'watermark', 'compress']) {
      await page.evaluate((j) => PS.bulk.open(j), job);
      await page.waitForTimeout(150);
      h.assert(await h.noOverflow(page), job + ' fits at 360px');
      const small = await page.$$eval('.pb-work button:not([hidden]), .pb-work .input', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && !e.classList.contains('pb-hit')).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().height)));
      h.assert.equal(small.length, 0, job + ' has small targets: ' + small.join(', '));
      h.assert.equal(await page.$$eval('.pb-work .btn-gold', (b) => b.filter((x) => x.offsetParent).length), 1, job + ': one gold button');
      h.assert(/never leave/.test(await page.textContent('.pb-head-sub')), 'privacy line');
    }
    await page.evaluate(() => PS.bulk.open('compress'));
    await pick(page, () => page.click('.pb-work .pb-source .btn:not(.btn-ghost)'), ['images-heavy.pdf']);
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result', { timeout: 60000 });
    (await h.inkContrast(page, '.pb-work .btn-gold')).forEach((c) => h.assert(c.ratio >= 4.5, 'primary button text ' + c.color + ' on ' + c.bg + ' is ' + c.ratio + ':1'));
    await page.evaluate(() => PS.bulk.open('protect'));
    await pick(page, () => page.click('.pb-work .pb-source .btn:not(.btn-ghost)'), ['form-template.pdf']);
    await page.click('.pb-suggest');
    await page.click('.pb-go');
    await page.waitForSelector('.pb-result');
    h.assert.equal(foreign.length, 0, 'cross-origin requests: ' + foreign.join(', '));
    h.assert.noErrors(page);
  }
};
