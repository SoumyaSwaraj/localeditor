'use strict';
/* Font library (F1): manifest, light loading, script slices, missing glyphs, offline saving, storage, PDF, picker. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/fonts-index.json'), 'utf8'));
const ORIGINAL_44 = ['Inter', 'Poppins', 'Montserrat', 'DM Sans', 'Manrope', 'Space Grotesk', 'Outfit', 'Nunito', 'Work Sans', 'Rubik', 'Plus Jakarta Sans',
  'Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display', 'Cormorant Garamond', 'Libre Baskerville', 'Fraunces', 'EB Garamond', 'Instrument Serif',
  'Bebas Neue', 'Anton', 'Archivo Black', 'Abril Fatface', 'Righteous', 'Lobster', 'Bungee', 'Oswald', 'Syne', 'Dancing Script', 'Great Vibes', 'Caveat',
  'Sacramento', 'Pacifico', 'Satisfy', 'Allura', 'Kalam', 'Shadows Into Light', 'Homemade Apple', 'Mr Dafoe', 'Alex Brush', 'JetBrains Mono', 'Space Mono', 'IBM Plex Mono'];
const FEELS = ['trust', 'calm', 'friendly', 'playful', 'elegant', 'bold', 'urgent', 'tense', 'nostalgic', 'technical'];
const isFont = (u) => /\/assets\/fonts\/(library|cjk|originals)\//.test(u);

function track(page) {
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url()));
  return reqs;
}
async function studioText(h, browser, base, vp, layer) {
  const page = await h.newDesign(browser, base, vp || 'desktop', 'Instagram post');
  await h.need(page, ['fonts']);
  const id = await page.evaluate((l) => { const c = window.LEStudio; const id = c.addText(l); c.scene.select([id]); return id; }, layer);
  await page.waitForTimeout(400);
  return { page, id };
}

module.exports = {
  'manifest: 200+ families, files present, allowed licences, originals resolve': async ({ h }) => {
    const idx = INDEX();
    const fams = idx.families;
    h.assert(fams.length >= 200, 'at least 200 families, got ' + fams.length);
    const names = fams.map((f) => f.family);
    ORIGINAL_44.forEach((n) => h.assert(names.indexOf(n) >= 0, 'original family still listed: ' + n));
    const cjkHere = fs.existsSync(path.join(ROOT, 'assets/fonts/cjk/available.json'));
    const cjk = cjkHere ? JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/fonts-cjk.json'), 'utf8')) : null;
    const lic = fs.readFileSync(path.join(ROOT, 'assets/vendor/licenses/fonts-LICENSES.md'), 'utf8');
    let files = 0;
    fams.forEach((f) => {
      h.assert(['OFL-1.1', 'Apache-2.0', 'MIT', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC'].indexOf(f.license) >= 0, f.family + ' licence ' + f.license);
      h.assert(['sans', 'serif', 'display', 'handwriting', 'mono'].indexOf(f.style) >= 0, f.family + ' style');
      h.assert(f.feel.length >= 1 && f.feel.length <= 3 && f.feel.every((x) => FEELS.indexOf(x) >= 0), f.family + ' feel ' + f.feel);
      h.assert(lic.indexOf('| ' + f.family + ' |') >= 0, f.family + ' in the licence table');
      h.assert(f.preview && f.preview.length, f.family + ' has a preview');
      if (f.source === 'localeditor') return;
      const dir = path.join(ROOT, f.cjk ? 'assets/fonts/cjk' : 'assets/fonts/library', f.slug);
      if (f.cjk && !cjkHere) return;
      h.assert(fs.existsSync(path.join(dir, 'LICENSE.txt')), f.family + ' LICENSE.txt');
      const text = fs.readFileSync(path.join(dir, 'LICENSE.txt'), 'utf8');
      h.assert(/Copyright/i.test(text) && /(SIL OPEN FONT LICENSE|Apache License)/i.test(text), f.family + ' licence text complete');
      const subs = f.cjk ? cjk[f.slug].subsets : f.subsets;
      f.faces.forEach((face) => subs.forEach((s) => {
        if (f.missing && f.missing[face] && f.missing[face].indexOf(s) >= 0) return;
        const p = path.join(dir, f.slug + '-' + s + '-' + face + '.' + f.rev + '.woff2');
        h.assert(fs.existsSync(p), 'missing file ' + p);
        files++;
      }));
    });
    idx.previews.forEach((p) => h.assert(fs.existsSync(path.join(ROOT, 'assets/fonts/previews', p)), 'preview pack ' + p));
    fams.forEach((f) => f.preview.forEach((p) => {
      const size = fs.statSync(path.join(ROOT, 'assets/fonts/previews', idx.previews[p[0]])).size;
      h.assert(p[1] + p[2] <= size, f.family + ' preview inside its pack');
    }));
    h.assert(files > 1000, 'file count ' + files);
  },

  'first load of the studio requests no library font and no manifest': async ({ browser, base, h }) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    /* The start screen's Quick makers row builds live previews and loads their fonts itself (le-studio-makers.js,
       not the font library); it is left out here so this checks what the library and the studio shell fetch. */
    await ctx.route('**/assets/js/le-studio-makers.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    const reqs = track(page);
    await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const bad = reqs.filter((u) => isFont(u) || /fonts-(index|details|cjk)\.json|\/previews\//.test(u));
    h.assert(!bad.length, 'no font requests on first load: ' + bad.join(', '));
    h.assert(await page.evaluate(() => LE.fonts.list().length >= 200 && LE.fonts.css('Inter').indexOf('Inter') >= 0), 'names answer without the index');
    /* LE.downloads asks for the size of "everything" synchronously when it lists the packs. */
    h.assert(await page.evaluate(() => typeof LE.fonts.sizeOf('all') === 'number' && LE.fonts.sizeOf('all') > 25e6), 'sizeOf(all) is a number at once');
    h.assert(await page.evaluate(() => LE.fonts.list({ source: 'localeditor' }).length === 20), 'originals registered without the index');
    h.assert(!reqs.some((u) => /fonts-index\.json/.test(u)), 'still no index');
    await ctx.close();
  },

  'opening the picker loads only the slim index and visible previews': async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
    await h.need(page, ['fonts']);
    const reqs = track(page);
    await h.openPanel(page, 'fonts');
    await page.waitForSelector('.sf-row .sf-name.is-ready');
    await page.waitForTimeout(500);
    h.assert(!reqs.some(isFont), 'no font files: ' + reqs.filter(isFont).join(', '));
    h.assert(reqs.filter((u) => /fonts-index\.json/.test(u)).length <= 1, 'index at most once');
    h.assert(!reqs.some((u) => /fonts-(details|cjk)\.json/.test(u)), 'no details or CJK table');
    const packs = reqs.filter((u) => /\/previews\/pack-/.test(u));
    h.assert(packs.length >= 1 && packs.length <= 2, 'one or two preview packs, got ' + packs.length);
    const rows = await page.evaluate(() => document.querySelectorAll('.sf-row').length);
    h.assert(rows > 5 && rows < 40, 'virtual list renders only visible rows (' + rows + ')');
    /* The name is drawn by its preview subset, not the UI font. */
    const ff = await page.evaluate(() => getComputedStyle(document.querySelector('.sf-row .sf-name')).fontFamily);
    h.assert(/LEP /.test(ff), 'preview font family ' + ff);
    h.assert.noErrors(page);
    await page.context().close();
  },

  'choosing a font loads only the script slices the text needs': async ({ browser, base, h }) => {
    const { page, id } = await studioText(h, browser, base, 'desktop', { text: 'Hello', font: 'Inter', size: 80 });
    const reqs = track(page);
    await page.evaluate(() => window.LEStudioFonts.apply(window.LEStudio, 'Lobster'));
    await page.waitForTimeout(1200);
    const lob = reqs.filter((u) => /\/lobster\//.test(u)).map((u) => u.split('/').pop());
    h.assert(lob.length && lob.every((n) => /-latin(-ext)?-/.test(n)), 'Latin only: ' + lob.join(', '));
    await page.evaluate((i) => window.LEStudio.patch(i, { text: 'Привет' }), id);
    await page.waitForTimeout(1200);
    h.assert(reqs.some((u) => /lobster-cyrillic-/.test(u)), 'Cyrillic slice once Cyrillic is typed');
    h.assert(!reqs.some((u) => /lobster-vietnamese-/.test(u)), 'no Vietnamese slice');
    h.assert(await page.evaluate(() => document.fonts.check('400 40px Lobster', 'Привет')), 'Cyrillic face is loaded');
    await page.context().close();
  },

  'old documents render each of the 44 original families': async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/studio/', 'desktop');
    await h.need(page, ['fonts']);
    const bad = await page.evaluate(async (names) => {
      const out = [];
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 80;
      const x = cv.getContext('2d');
      const draw = (font) => { x.clearRect(0, 0, 600, 80); x.font = font; x.fillText('Hamburgefonstiv 0123', 4, 60); return cv.toDataURL(); };
      for (const n of names) {
        try { await LE.fonts.load(n, 400, false); } catch (e) { out.push(n + ': ' + e.message); continue; }
        const real = draw('40px ' + LE.fonts.css(n));
        const plain = draw('40px sans-serif');
        const mono = draw('40px serif');
        /* Rendering, not document.fonts.check(): the site chrome declares its own "Instrument Serif" face in CSS. */
        if (real === plain || real === mono) out.push(n + ' did not render');
      }
      return out;
    }, ORIGINAL_44);
    h.assert(!bad.length, bad.join('; '));
    await page.context().close();
  },

  'missing letters fall back per script (Devanagari, Arabic, Cyrillic), no boxes': async ({ browser, base, h }) => {
    const { page } = await studioText(h, browser, base, 'desktop', { text: 'Sale नमस्ते مرحبا Привет', font: 'Abril Fatface', size: 60 });
    await page.waitForFunction(() => LE.fonts.css('Abril Fatface').indexOf('Noto Sans Devanagari') >= 0 && LE.fonts.css('Abril Fatface').indexOf('Noto Sans Arabic') >= 0, null, { timeout: 15000 });
    const r = await page.evaluate(async () => {
      const stack = LE.fonts.css('Abril Fatface');
      const cv = document.createElement('canvas'); cv.width = 200; cv.height = 90;
      const x = cv.getContext('2d');
      const draw = (font, t) => { x.clearRect(0, 0, 200, 90); x.font = font; x.fillText(t, 10, 64); return cv.toDataURL(); };
      const box = draw('48px "Abril Fatface"', '͸');
      const out = { stack, tofu: [], match: {} };
      [['नमस्ते', 'Noto Sans Devanagari'], ['مرحبا', 'Noto Sans Arabic'], ['Привет', 'Noto Sans']].forEach(([t, fb]) => {
        for (const ch of Array.from(t)) if (draw('48px ' + stack, ch) === box) out.tofu.push(ch);
        out.match[fb] = draw('48px ' + stack, t) === draw('48px "' + fb + '"', t);
      });
      return out;
    });
    h.assert(!r.tofu.length, 'no tofu: ' + r.tofu.join(''));
    h.assert(r.match['Noto Sans Devanagari'] && r.match['Noto Sans Arabic'] && r.match['Noto Sans'], 'drawn by the fallback families ' + JSON.stringify(r.match));
    h.assert(await page.evaluate(() => /no Hindi|no Arabic|no Cyrillic/.test(document.body.textContent)), 'the person is told');
    await page.context().close();
  },

  'save for offline, use with no network, remove, storage manager lists it': async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/studio/', 'desktop');
    await h.need(page, ['fonts']);
    const r = await page.evaluate(async () => {
      const size = await LE.fonts.sizeOf('Kanit');
      let first = null;
      const res = await LE.fonts.saveOffline('Kanit', (p) => { if (!first) first = p; });
      return { size, first, res, off: await LE.fonts.isOffline('Kanit') };
    });
    h.assert(r.size > 0 && r.first && r.first.totalBytes === r.size, 'total bytes up front');
    h.assert(r.off && r.res.bytes > 0, 'saved');
    /* A fresh page with the font files and index unreachable: the font still loads, from this device. */
    await page.context().route('**/assets/fonts/library/**', (rt) => rt.abort());
    await page.context().route('**/assets/data/fonts-index.json', (rt) => rt.abort());
    const p2 = await page.context().newPage();
    await p2.goto(base + '/studio/', { waitUntil: 'networkidle' });
    const ok = await p2.evaluate(async () => { await LE.fonts.load('Kanit', { weights: [700], text: 'Hello สวัสดี' }); return document.fonts.check('700 30px Kanit', 'สวัสดี'); });
    h.assert(ok, 'renders offline');
    const rep = await p2.evaluate(async () => { const r = await LEPwa.report(); return r.categories.filter((c) => c.id === 'fonts')[0]; });
    const kan = rep.items.filter((i) => i.name === 'Kanit')[0];
    h.assert(kan && kan.bytes > 0 && /Saved on this device/.test(kan.detail), 'storage manager lists Kanit: ' + JSON.stringify(rep.items.map((i) => i.name)));
    const after = await p2.evaluate(async () => { await LE.fonts.removeOffline('Kanit'); return { off: await LE.fonts.isOffline('Kanit'), use: (await LE.fonts.usage()).filter((u) => u.family === 'Kanit') }; });
    h.assert(!after.off && !after.use.length, 'removed and freed');
    await page.context().close();
  },

  'trimming downloads never breaks a saved design font': async ({ browser, base, h }) => {
    const { page } = await studioText(h, browser, base, 'desktop', { text: 'Keep me', font: 'Bodoni Moda', size: 80 });
    /* Fonts of a saved design are kept automatically (default mode). */
    let has = false;
    for (let i = 0; i < 30 && !has; i++) {
      await page.waitForTimeout(500);
      has = await page.evaluate(async () => (await caches.open('le-fonts-saved-v1').then((c) => c.keys())).some((k) => /bodoni-moda/.test(k.url)));
    }
    h.assert(has, 'the design font was kept on this device automatically');
    const kept = await page.evaluate(async () => {
      const n = async () => (await caches.open('le-fonts-saved-v1').then((c) => c.keys())).length;
      const a = await n();
      LEPwa.setLimits({ budgetMB: 0 });
      await LEPwa.freeUpSpace();
      await caches.delete('le-fonts-v1');
      return [a, await n()];
    });
    h.assert(kept[1] > 0 && kept[1] === kept[0], 'kept files survive Free up space: ' + kept);
    await page.context().route('**/assets/fonts/library/**', (rt) => rt.abort());
    const p2 = await page.context().newPage();
    await p2.goto(base + '/studio/', { waitUntil: 'networkidle' });
    const ok = await p2.evaluate(async () => {
      try { await LE.fonts.load('Bodoni Moda', { weights: [400], text: 'Keep me' }); } catch (e) { return e.message + ' ' + JSON.stringify((await caches.open('le-fonts-saved-v1').then((c) => c.keys())).map((k) => k.url.split('/').pop())); }
      return document.fonts.check('40px "Bodoni Moda"', 'Keep');
    });
    h.assert(ok === true, 'design font still loads after trimming, with no network: ' + ok);
    await page.context().close();
  },

  'PDF embeds a new static family and an instanced variable family as real text': async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/pdf-studio/', 'desktop');
    const out = await page.evaluate(async () => {
      await LE.pdf.ready();
      const d = await PDFLib.PDFDocument.create();
      d.addPage([600, 400]);
      let bytes = await d.save();
      bytes = await LE.pdf.watermark(bytes, { text: 'Kanit Sale', font: 'Kanit', weight: 700, size: 40, opacity: 1 });
      const b2 = await LE.pdf.watermark(bytes, { text: 'Slab Heavy', font: 'Roboto Slab', weight: 800, size: 30, opacity: 1 });
      const f4 = fontkit.create(await LE.fonts.bytes('Roboto Slab', 400, false));
      const f8 = fontkit.create(await LE.fonts.bytes('Roboto Slab', 800, false));
      const adv = (f) => f.glyphsForString('Heavy').reduce((a, g) => a + g.advanceWidth, 0);
      let b64 = ''; const u = new Uint8Array(b2); for (let i = 0; i < u.length; i += 0x8000) b64 += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return { pdf: btoa(b64), w4: adv(f4), w8: adv(f8), cls: f8['OS/2'].usWeightClass, axes: Object.keys(f8.variationAxes || {}).length, warn: (LE.pdf.lastReport || {}).warnings };
    });
    h.assert(out.w8 > out.w4 && out.cls === 800 && out.axes === 0, 'static 800 instance: ' + JSON.stringify(out));
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const pg = await ctx.newPage();
    await pg.goto(base + '/404.html');
    await pg.addScriptTag({ url: base + '/assets/vendor/pdf.min.js' });
    const info = await pg.evaluate(async ([b64, root]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = root + '/assets/vendor/pdf.worker.min.js';
      const bin = atob(b64); const data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, fontExtraProperties: true }).promise;
      const p = await doc.getPage(1);
      const tc = await p.getTextContent();
      const ops = await p.getOperatorList();
      const fonts = [];
      ops.fnArray.forEach((fn, i) => { if (fn === pdfjsLib.OPS.setFont) { const f = p.commonObjs.get(ops.argsArray[i][0]); fonts.push({ name: f.name, missing: !!f.missingFile, glyphs: f.data ? f.data.length : 0 }); } });
      return { text: tc.items.map((x) => x.str).join(' '), fonts };
    }, [out.pdf, base]);
    await ctx.close();
    h.assert(/Kanit Sale/.test(info.text) && /Slab Heavy/.test(info.text), 'real text: ' + info.text);
    const kan = info.fonts.filter((f) => /Kanit/i.test(f.name))[0];
    const slab = info.fonts.filter((f) => /Roboto ?Slab/i.test(f.name))[0];
    h.assert(kan && !kan.missing && kan.glyphs > 0, 'Kanit embedded ' + JSON.stringify(info.fonts));
    h.assert(slab && !slab.missing && slab.glyphs > 0, 'Roboto Slab embedded ' + JSON.stringify(info.fonts));
    await page.context().close();
  },

  'picker at phone sizes: search, filters, touch preview then use, no sideways scroll': async ({ browser, base, h }) => {
    for (const vp of ['phone', 'small']) {
      const { page, id } = await studioText(h, browser, base, vp, { text: 'Hello', font: 'Inter', size: 80 });
      await h.openPanel(page, 'fonts');
      await page.waitForSelector('.sf-row');
      await page.waitForTimeout(600); /* the phone sheet animates in (transform) */
      h.assert(await h.noOverflow(page), vp + ' no sideways scroll');
      /* Layout size, not the painted box: offsetHeight ignores the sheet's transform. */
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('.sf-pick, .sf-fav, .sf-search input, .sf-select select')).filter((n) => n.offsetHeight && n.offsetHeight < 44).map((n) => n.className + ':' + n.offsetHeight));
      h.assert(small.length === 0, vp + ' 44px targets: ' + small.join(', '));
      await page.fill('.sf-search input', 'pacif');
      await page.waitForTimeout(300);
      h.assert(await page.evaluate(() => document.querySelector('.sf-row .sf-pick').getAttribute('data-fam') === 'Pacifico'), 'search finds Pacifico');
      const before = await page.evaluate(() => window.LEStudio.scene.canUndo());
      await page.tap('.sf-row .sf-pick');
      await page.waitForTimeout(300);
      const pv = await page.evaluate((i) => ({ live: window.LEStudio.scene._find(i).font, bar: !document.querySelector('.sf-pvbar').hidden }), id);
      h.assert(pv.live === 'Pacifico' && pv.bar, vp + ' tap previews: ' + JSON.stringify(pv));
      await page.tap('.sf-pvbar [data-use]');
      await page.waitForTimeout(300);
      const d = await h.doc(page);
      h.assert(d.layers.filter((l) => l.id === id)[0].font === 'Pacifico', 'committed');
      h.assert(before === false || (await page.evaluate(() => window.LEStudio.scene.canUndo())), 'one undo step');
      await page.fill('.sf-search input', '');
      await page.selectOption('.sf-select select[name=script]', 'devanagari');
      await page.waitForTimeout(300);
      const lang = await page.evaluate(() => Array.from(document.querySelectorAll('.sf-pick')).map((b) => LE.fonts.find(b.getAttribute('data-fam')).scripts.indexOf('devanagari') >= 0));
      h.assert(lang.length && lang.every(Boolean), 'language filter');
      h.assert(await h.noOverflow(page), vp + ' still no sideways scroll');
      h.assert.noErrors(page);
      await page.context().close();
    }
  },

  'desktop hover previews without history, mouse leave restores, weight slider for variable fonts': async ({ browser, base, h }) => {
    const { page, id } = await studioText(h, browser, base, 'desktop', { text: 'Hover me', font: 'Inter', weight: 400, size: 80 });
    await h.openPanel(page, 'fonts');
    await page.waitForSelector('.sf-row');
    const undo0 = await page.evaluate(() => window.LEStudio.scene.canUndo());
    await page.hover('.sf-row:nth-child(3) .sf-pick');
    await page.waitForTimeout(400);
    const live = await page.evaluate((i) => window.LEStudio.scene._find(i).font, id);
    h.assert(live !== 'Inter', 'hover previews');
    h.assert((await page.evaluate(() => window.LEStudio.scene.canUndo())) === undo0, 'no history while previewing');
    await page.mouse.move(900, 500);
    await page.waitForTimeout(200);
    h.assert((await page.evaluate((i) => window.LEStudio.scene._find(i).font, id)) === 'Inter', 'restored');
    h.assert(await page.evaluate(() => !!document.querySelector('.sf-current input[type=range]')), 'weight slider for Inter');
    await page.context().close();
  },

  'LocalEditor originals: their own view, descriptions, intent filter, real faces, PDF': async ({ browser, base, h }) => {
    const { page, id } = await studioText(h, browser, base, 'desktop', { text: 'Hello', font: 'Inter', size: 80 });
    await h.openPanel(page, 'fonts');
    await page.waitForSelector('.sf-row');
    await page.click('[data-view=originals]');
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.sf-pick')).map((b) => [b.getAttribute('data-fam'), b.querySelector('small').textContent]));
    const LE_ORIG = await page.evaluate(() => LE.fontsOriginals.list().map((f) => f.family));
    h.assert(await page.evaluate(() => document.querySelector('.sf-count').textContent) === '20 fonts', 'twenty originals in the view');
    h.assert(rows.length >= 8 && rows.every((r) => LE_ORIG.indexOf(r[0]) >= 0), 'rows are originals: ' + rows.map((r) => r[0]));
    const desc = await page.evaluate(() => LE.fontsOriginals.list().map((f) => f.description));
    h.assert(rows.every((r) => desc.indexOf(r[1]) >= 0), 'description as subtitle');
    await page.click('.sf-intents [data-intent=trust]');
    await page.waitForTimeout(300);
    const trust = await page.evaluate(() => Array.from(document.querySelectorAll('.sf-pick')).map((b) => LE.fonts.find(b.getAttribute('data-fam')).intent));
    h.assert(trust.length === 5 && trust.every((x) => x === 'trust'), 'intent filter: ' + trust);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.sf-row .sf-name')).fontFamily.indexOf('Anchorline') >= 0 || /Northwall|Plainfield|Clearwell|Hearthbook/.test(getComputedStyle(document.querySelector('.sf-row .sf-name')).fontFamily));
    await page.evaluate(() => window.LEStudioFonts.apply(window.LEStudio, 'Anchorline'));
    await page.waitForTimeout(800);
    h.assert((await h.doc(page)).layers.filter((l) => l.id === id)[0].font === 'Anchorline', 'applied');
    h.assert(await page.evaluate(() => document.fonts.check('40px Anchorline', 'Hello')), 'real face loaded');
    const pdf = await page.evaluate(async () => { const b = await LE.fonts.bytes('Anchorline', 700, false); const f = fontkit.create(b); return { glyphs: f.numGlyphs, w: f['OS/2'].usWeightClass }; }).catch((e) => ({ err: e.message }));
    h.assert(pdf.glyphs > 50, 'PDF source for an original: ' + JSON.stringify(pdf));
    h.assert.noErrors(page);
    await page.context().close();
  }
  ,
  'Convert to PDF makes real text with no connection after a first visit (PDF faces kept offline)': async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/convert-to-pdf/', 'desktop');
    page.setDefaultTimeout(60000);
    await page.waitForFunction(() => window.LE && LE.lazy && LE.fonts && LE.fonts.keepPdfFaces);
    /* What the first-idle / Basic-pack hook does, without waiting for idle. */
    const kept = await page.evaluate(async () => { try { localStorage.removeItem('le-fonts-pdf-faces'); } catch (e) {} return LE.fonts.keepPdfFaces(); });
    h.assert(kept === true, 'PDF faces kept');
    const off = await page.evaluate(async () => Promise.all(LE.fonts.PDF_FACES.map((f) => LE.fonts.isOffline(f))));
    h.assert(off.every(Boolean), 'all four saved: ' + off);
    /* Second visit with the font files and the font index unreachable. */
    await page.context().route('**/assets/fonts/library/**', (rt) => rt.abort());
    await page.context().route('**/assets/data/fonts-index.json', (rt) => rt.abort());
    const p2 = await page.context().newPage();
    await p2.goto(base + '/convert-to-pdf/', { waitUntil: 'networkidle' });
    await p2.waitForFunction(() => window.LE && LE.lazy);
    const r = await p2.evaluate(async () => {
      await LE.lazy('../assets/js/le-convert.js');
      const res = await fetch('/scripts/fixtures/sample.md');
      const out = await LE.convert.toPDF(new File([await res.arrayBuffer()], 'sample.md'), {});
      if (!window.pdfjsLib) await LE.lazy('../assets/vendor/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '../assets/vendor/pdf.worker.min.js';
      const d = await pdfjsLib.getDocument({ data: out.bytes.slice(0), isEvalSupported: false }).promise;
      const pg = await d.getPage(1);
      const tc = await pg.getTextContent();
      const ops = await pg.getOperatorList();
      const fonts = [];
      ops.fnArray.forEach((fn, i) => { if (fn === pdfjsLib.OPS.setFont) { const f = pg.commonObjs.get(ops.argsArray[i][0]); fonts.push(f.name); } });
      return { text: tc.items.map((x) => x.str).join(' ').slice(0, 200), fonts, warnings: out.warnings || [] };
    });
    h.assert(r.text.replace(/\s/g, '').length > 20, 'real text: ' + r.text);
    h.assert(r.fonts.some((n) => /Jakarta|Lora|JetBrains|Manrope/i.test(n)), 'set in the library faces: ' + JSON.stringify(r.fonts) + ' ' + JSON.stringify(r.warnings));
    await page.context().close();
  }
};
