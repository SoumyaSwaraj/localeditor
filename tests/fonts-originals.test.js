/* LocalEditor originals (wave 2F, F2): the twenty in-house typefaces in assets/fonts/originals/.
   Font files are built by tools/typefoundry/build_all.py; this file checks what users get. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/fonts-originals.json'), 'utf8'));
const FAMS = MANIFEST.families;
const SHIM = '<script src="../assets/js/le-fonts-originals.js"></script>';

/* Code points every family must cover (the brief): ASCII, the social / price-list symbols, Latin-1 and Latin Extended-A. */
const REQUIRED = (() => {
  const cps = [];
  for (let c = 0x20; c < 0x7f; c++) cps.push(c);
  for (let c = 0xa0; c <= 0x17f; c++) cps.push(c);
  '‘’“”‚„–—…•«»‹›€£₹¥¢©®™°'.split('').forEach((ch) => cps.push(ch.codePointAt(0)));
  [0x218, 0x219, 0x21a, 0x21b, 0x2212].forEach((c) => cps.push(c));
  return Array.from(new Set(cps));
})();

/* Serve a page with the originals shim added right after le-fonts.js (the studio does not include it yet:
   adding that one script tag is the integration step). */
async function withShim(page, base, url) {
  await page.route('**' + url, async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    body = body.replace(/(<script src="\.\.\/assets\/js\/le-fonts\.js"( defer)?><\/script>)/, (m, tag, d) => tag + SHIM.replace('></script>', (d || '') + '></script>'));
    await route.fulfill({ response: res, body });
  });
}

async function blank(browser, base) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.msgs = [];
  page.on('console', (m) => page.msgs.push(m.type() + ': ' + m.text()));
  await page.goto(base + '/404.html');
  return page;
}

module.exports = {
  'manifest lists twenty families, five per intent, with the fixed feel tags': async ({ h }) => {
    const FEELS = ['trust', 'calm', 'friendly', 'playful', 'elegant', 'bold', 'urgent', 'tense', 'nostalgic', 'technical'];
    h.assert.equal(FAMS.length, 20, 'twenty families');
    ['attention', 'trust', 'positive', 'tension'].forEach((i) => h.assert.equal(FAMS.filter((f) => f.intent === i).length, 5, i + ' has five'));
    const names = new Set();
    FAMS.forEach((f) => {
      h.assert(!names.has(f.family), 'unique name ' + f.family); names.add(f.family);
      h.assert(f.source === 'localeditor', 'source localeditor');
      h.assert(f.feel.length >= 1 && f.feel.every((x) => FEELS.includes(x)), 'feel tags from the fixed list: ' + f.family);
      h.assert(f.description && f.description.length < 90, 'one-line description: ' + f.family);
      h.assert(fs.existsSync(path.join(ROOT, 'assets/fonts/originals', f.slug, 'LICENSE')), 'LICENSE for ' + f.family);
      h.assert(fs.existsSync(path.join(ROOT, 'assets/fonts/originals', f.slug, 'family.json')), 'family.json for ' + f.family);
    });
  },

  'byte budget: every woff2 under 40 KB, totals reported': async ({ h }) => {
    let w2 = 0, w1 = 0;
    FAMS.forEach((f) => Object.keys(f.files).forEach((w) => {
      const a = fs.statSync(path.join(ROOT, f.files[w].woff2)).size;
      const b = fs.statSync(path.join(ROOT, f.files[w].woff)).size;
      h.assert(a < 40 * 1024, f.family + ' ' + w + ' woff2 is ' + a + ' bytes');
      w2 += a; w1 += b;
    }));
    h.assert(w2 < 1000 * 1024, 'all woff2 together under 1000 KB (' + w2 + ')');
    h.assert(w1 < 1600 * 1024, 'all woff (PDF embedding) together under 1600 KB (' + w1 + ')');
    console.log('       originals: ' + Math.round(w2 / 1024) + ' KB woff2 (browser), ' + Math.round(w1 / 1024) + ' KB woff (PDF), 40 instances');
  },

  'every instance loads in Chromium with no font warnings (OTS)': async ({ browser, base, h }) => {
    const page = await blank(browser, base);
    const files = [];
    FAMS.forEach((f) => Object.keys(f.files).forEach((w) => files.push([f.family, Number(w), f.files[w].woff2, f.files[w].woff])));
    const res = await page.evaluate(async (list) => {
      const out = [];
      for (const [fam, w, w2, w1] of list) {
        for (const file of [w2, w1]) {
          const face = new FontFace('T-' + fam + '-' + w + file.slice(-5), 'url(/' + file + ')', { weight: String(w) });
          try { await face.load(); out.push([file, face.status]); } catch (e) { out.push([file, 'error ' + e.message]); }
        }
      }
      return out;
    }, files);
    res.forEach(([file, st]) => h.assert(st === 'loaded', file + ': ' + st));
    const bad = page.msgs.filter((m) => /OTS|font|decode/i.test(m));
    h.assert(!bad.length, 'console: ' + bad.join(' | '));
    await page.context().close();
  },

  'coverage, metrics and tabular figures (parsed with the app\'s fontkit)': async ({ browser, base, h }) => {
    const page = await blank(browser, base);
    await page.addScriptTag({ url: base + '/assets/vendor/fontkit.umd.min.js' });
    const list = [];
    FAMS.forEach((f) => Object.keys(f.files).forEach((w) => list.push([f.family, w, f.files[w].woff])));
    const out = await page.evaluate(async ([items, req]) => {
      const res = [];
      for (const [fam, w, file] of items) {
        const buf = new Uint8Array(await (await fetch('/' + file)).arrayBuffer());
        const font = fontkit.create(buf);
        const missing = req.filter((cp) => !font.hasGlyphForCodePoint(cp)).map((cp) => cp.toString(16));
        const adv = (ch) => font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth;
        const digits = '0123456789'.split('').map(adv);
        res.push({ fam, w, missing, upm: font.unitsPerEm, asc: font.ascent, desc: font.descent, gap: font.lineGap, n: adv('n'), H: adv('H'), space: adv(' '), digits,
          maxAdv: Math.max.apply(null, req.map((cp) => font.glyphForCodePoint(cp).advanceWidth)), minAdv: Math.min.apply(null, req.map((cp) => font.glyphForCodePoint(cp).advanceWidth)) });
      }
      return res;
    }, [list, REQUIRED]);
    out.forEach((r) => {
      const id = r.fam + ' ' + r.w;
      h.assert(!r.missing.length, id + ' missing ' + r.missing.join(' '));
      h.assert(r.upm === 1000 && r.asc === 950 && r.desc === -250 && r.gap === 0, id + ' shared vertical metrics');
      h.assert(r.n > 280 && r.n < 1100 && r.H > 350 && r.H < 1300, id + ' sane n/H advances ' + r.n + '/' + r.H);
      h.assert(r.space > 100 && r.space < 450, id + ' space ' + r.space);
      h.assert(new Set(r.digits).size === 1, id + ' tabular figures');
      h.assert(r.minAdv >= 0 && r.maxAdv < 1900, id + ' advances in range');
    });
    await page.context().close();
  },

  'kerning is applied and Bold is heavier than Regular': async ({ browser, base, h }) => {
    const page = await blank(browser, base);
    const res = await page.evaluate(async (fams) => {
      const out = [];
      for (const f of fams) {
        for (const w of ['400', '700']) {
          const face = new FontFace(f.family, 'url(/' + f.files[w].woff2 + ')', { weight: w });
          document.fonts.add(await face.load());
        }
        const span = (txt, kern, w) => {
          const s = document.createElement('span');
          s.style.cssText = 'position:absolute;white-space:pre;font-size:200px;font-family:"' + f.family + '";font-weight:' + w + ';font-kerning:' + kern;
          s.textContent = txt; document.body.appendChild(s);
          const r = s.getBoundingClientRect().width; s.remove(); return r;
        };
        const ink = (w) => {
          const c = document.createElement('canvas'); c.width = 900; c.height = 260;
          const x = c.getContext('2d'); x.font = w + ' 160px "' + f.family + '"'; x.fillText('Hamburg', 10, 200);
          const d = x.getImageData(0, 0, 900, 260).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i]; return n;
        };
        out.push({ fam: f.family, av: span('AV', 'normal', 400), avOff: span('AV', 'none', 400), to: span('To', 'normal', 400), toOff: span('To', 'none', 400), r: ink(400), b: ink(700) });
      }
      return out;
    }, FAMS);
    res.forEach((r) => {
      h.assert(r.avOff - r.av > 4 || r.toOff - r.to > 4, r.fam + ': kerning not applied (AV ' + r.av + ' vs ' + r.avOff + ')');
      h.assert(r.b > r.r * 1.12, r.fam + ': Bold not heavier (' + r.r + ' vs ' + r.b + ')');
    });
    await page.context().close();
  },

  'specimen page: no console errors, no sideways scroll, studio links carry the family': async ({ browser, base, h }) => {
    for (const vp of ['phone', 'small', 'desktop']) {
      const page = await h.open(browser, base, '/fonts/', vp);
      await page.waitForSelector('.fo-card');
      h.assert.equal(await page.locator('.fo-card').count(), 20, 'twenty cards');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      h.assert(await h.noOverflow(page), 'no sideways scroll at ' + vp);
      if (vp === 'desktop') {
        await page.fill('#fo-text', 'Größe ½ €3.50 — Łódź');
        await page.waitForTimeout(150);
        h.assert.equal(await page.locator('.fo-card .fo-sample').first().textContent(), 'Größe ½ €3.50 — Łódź', 'try your own text');
        await page.click('.fo-weight [data-w="700"]');
        const link = page.locator('.fo-card [data-studio]').nth(7);
        await link.focus();
        const href = await link.getAttribute('href');
        h.assert(/^\.\.\/studio\/#d=j[A-Za-z0-9_-]+$/.test(href), 'template link ' + href.slice(0, 40));
        const json = JSON.parse(Buffer.from(href.split('#d=j')[1], 'base64url').toString('utf8'));
        const fam = await page.locator('.fo-card').nth(7).getAttribute('data-family');
        h.assert.equal(json.pages[0].layers[0].font, fam, 'link uses the family');
        h.assert.equal(json.pages[0].layers[0].weight, 700, 'link uses the weight');
        h.assert.equal(json.pages[0].layers[0].text, 'Größe ½ €3.50 — Łódź', 'link uses the typed text');
        const loaded = await page.evaluate(() => document.fonts.check('40px "' + document.querySelector('.fo-card').getAttribute('data-family') + '"'));
        h.assert(loaded, 'first family loaded on the page');
      }
      h.assert.noErrors(page);
      await page.context().close();
    }
  },

  'studio: each family renders on a text layer and exports in a PNG': async ({ browser, base, h }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await withShim(page, base, '/studio/');
    await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene && window.LE.fontsOriginals);
    await page.evaluate(() => window.LEStudio.useSample());
    await page.waitForFunction(() => window.LEStudio.scene.layers().length > 0);
    const names = await page.evaluate(() => window.LE.fonts.list().filter((f) => f.source === 'localeditor').map((f) => f.family));
    h.assert.equal(names.length, 20, 'LE.fonts.list() includes the twenty originals');
    const layers = FAMS.map((f, i) => ({ type: 'text', text: f.family + ' Åß€', font: f.family, size: 40, x: 20 + (i % 2) * 520, y: 20 + Math.floor(i / 2) * 60, w: 500 }));
    await h.addLayers(page, layers);
    await page.evaluate(() => Promise.all(window.LE.fontsOriginals.list().map((f) => window.LE.fonts.load(f.family, 400))));
    await page.waitForTimeout(400);
    const ok = await page.evaluate(() => window.LE.fontsOriginals.list().every((f) => document.fonts.check('40px "' + f.family + '"')));
    h.assert(ok, 'every family loaded for the canvas');
    const doc = await h.doc(page);
    const used = new Set(JSON.stringify(doc).match(/"font":"[^"]+"/g));
    FAMS.forEach((f) => h.assert(used.has('"font":"' + f.family + '"'), 'layer keeps ' + f.family));
    const blob = await page.evaluate(async () => { const b = await window.LEStudio.exportImage({ format: 'png', dryRun: true }); return b ? (b.size || (b.blob && b.blob.size) || 1) : 0; });
    h.assert(blob > 1000, 'PNG export produced a file (' + blob + ' bytes)');
    h.assert(!page.errors.length, page.errors.join(' | '));
    await ctx.close();
  },

  'studio: a "Use in the studio" link opens a design in that family': async ({ browser, base, h }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await withShim(page, base, '/studio/');
    const src = fs.readFileSync(path.join(ROOT, 'fonts/index.html'), 'utf8');
    const href = /href="\.\.\/studio\/(#d=j[A-Za-z0-9_-]+)"/.exec(src)[1];
    await page.goto(base + '/studio/' + href, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-yes]', { timeout: 15000 });
    await page.click('[data-yes]');
    await page.waitForFunction(() => window.LEStudio.scene.layers().some((l) => l.type === 'text'));
    const font = await page.evaluate(() => window.LEStudio.scene.layers().filter((l) => l.type === 'text')[0].font);
    h.assert.equal(font, FAMS[0].family, 'text layer in ' + FAMS[0].family);
    await ctx.close();
  },

  'PDF: originals embed through the app\'s PDF engine (pdf-lib + fontkit)': async ({ browser, base, h }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await withShim(page, base, '/pdf-studio/');
    await page.goto(base + '/pdf-studio/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.LE && window.LE.pdf && window.LE.fontsOriginals && window.LE.fonts.list().some((f) => f.source === 'localeditor'));
    const fams = ['Anchorline', 'Spotlit', 'Doodlebee', 'Frostgrid'];
    const out = await page.evaluate(async (list) => {
      await window.LE.pdf.ready();
      const doc = await window.PDFLib.PDFDocument.create();
      doc.addPage([400, 300]);
      let bytes = await doc.save();
      const res = [];
      for (const fam of list) {
        bytes = await window.LE.pdf.headerFooter(bytes, { headerCenter: fam + ' Größe €3.50 Łódź', font: fam, size: 14 });
        const rep = window.LE.pdf.lastReport || { warnings: [] };
        res.push({ fam, warnings: (rep.warnings || []).slice() });
      }
      let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return { res, b64: btoa(s) };
    }, fams);
    out.res.forEach((r) => h.assert(!r.warnings.some((w) => /font/i.test(w)), r.fam + ': ' + r.warnings.join(' ')));
    /* Ł is outside WinAnsi, so the standard-font fallback could not have drawn this text: extracting it proves
       the original was embedded. */
    const buf = Buffer.from(out.b64, 'base64');
    const read = await h.pdfRead(browser, base, buf);
    fams.forEach((f) => h.assert(read.text.indexOf(f + ' Größe €3.50 Łódź') >= 0, f + ' text extracts: ' + read.text.slice(0, 200)));
    await ctx.close();
  }
};
