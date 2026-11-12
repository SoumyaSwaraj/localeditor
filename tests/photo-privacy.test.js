'use strict';
/* Photo privacy check (2.7): /photo-privacy/ and LE.privacy. Fixtures are synthetic files made by
   tests/fixtures/privacy/make-fixtures.js; expected.json lists every value planted in each. */
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'privacy');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));
const HOSTILE = fs.readdirSync(FIX).filter((f) => /^hostile-/.test(f));

async function openTool(h, browser, base, vp, opts) {
  const page = await h.open(browser, base, '/photo-privacy/', vp, opts);
  page.foreign = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !/^(data|blob):/.test(u)) page.foreign.push(u); });
  await page.waitForFunction(() => window.LE && window.LE.privacy && window.LEPhotoPrivacy);
  return page;
}
/* Runs LE.privacy in the page on a fixture fetched from the test server. */
function inPage(page, name, fn, arg) {
  return page.evaluate(async ([n, src, a]) => {
    const blob = await (await fetch('/tests/fixtures/privacy/' + n)).blob();
    const file = new File([blob], n, { type: blob.type });
    return (0, eval)('(' + src + ')')(file, a);
  }, [name, fn.toString(), arg === undefined ? null : arg]);
}
function zipEntries(buf) {
  const out = [];
  let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), xl = buf.readUInt16LE(o + 28);
    out.push({ name: buf.toString('utf8', o + 30, o + 30 + nl), data: buf.subarray(o + 30 + nl + xl, o + 30 + nl + xl + size) });
    o += 30 + nl + xl + size;
  }
  return out;
}

const cases = {};

cases['every fixture reports exactly the planted values'] = async ({ browser, base, h }) => {
  const page = await openTool(h, browser, base, 'desktop');
  for (const name of Object.keys(EXPECTED)) {
    const exp = EXPECTED[name];
    const rep = await inPage(page, name, async (file) => {
      const r = await LE.privacy.inspect(file);
      const items = {};
      r.items.forEach((i) => { if (i.group !== 'file' && !i.derived) items[i.key] = i.value; });
      const region = r.items.find((i) => i.key === 'gps.region');
      return { items, region: region ? region.value : null, orientation: r.orientation, supported: r.supported, level: r.level, summary: r.summary, thumb: !!r.thumbnail, notes: r.notes };
    });
    const want = Object.keys(exp).filter((k) => k[0] !== '_').sort();
    h.assert.equal(JSON.stringify(Object.keys(rep.items).sort()), JSON.stringify(want), name + ': the report lists exactly the planted details');
    want.forEach((k) => h.assert.equal(rep.items[k], exp[k], name + ' › ' + k));
    if (exp._region) h.assert(rep.region && rep.region.indexOf(exp._region) === 0, name + ': region ' + rep.region);
    if (exp._orientation) h.assert.equal(rep.orientation, exp._orientation, name + ': orientation');
    if (exp._unsupported) h.assert(!rep.supported && rep.notes.length, name + ': honest about what cannot be done');
    if (!want.length) h.assert(/^Nothing sensitive found/.test(rep.summary) && rep.level === 'none', name + ': nothing-found state');
    if (want.length && exp['gps.position']) h.assert(/where/.test(rep.summary) && rep.level === 'high', name + ': summary names the location');
  }
  const full = await inPage(page, 'full.jpg', async (file) => {
    const r = await LE.privacy.inspect(file);
    return { thumb: r.thumbnail && [r.thumbnail.width, r.thumbnail.height, r.thumbnail.bytes[0], r.thumbnail.bytes[1]], gps: r.gps, summary: r.summary };
  });
  h.assert.equal(JSON.stringify(full.thumb), JSON.stringify([160, 120, 0xFF, 0xD8]), 'the embedded preview is extracted');
  h.assert(Math.abs(full.gps.lat - 48.858222) < 1e-5 && Math.abs(full.gps.lon - 2.2945) < 1e-5, 'GPS decimal degrees');
  h.assert(/where and when it was taken, the device that took it/.test(full.summary), 'plain-language summary: ' + full.summary);
  h.assert.noErrors(page);
};

cases['damaged and hostile files never throw, hang or inject markup'] = async ({ browser, base, h }) => {
  const page = await openTool(h, browser, base, 'desktop');
  for (const name of HOSTILE) {
    const t0 = Date.now();
    const r = await inPage(page, name, async (file) => {
      const rep = await LE.privacy.inspect(file);
      const cl = await LE.privacy.clean(file);
      return { ok: !!rep.summary, warnings: rep.warnings, clean: cl.ok, verified: cl.verified };
    });
    h.assert(r.ok, name + ' gives a report');
    h.assert(Date.now() - t0 < 8000, name + ' finishes quickly');
    if (r.clean) h.assert(r.verified, name + ': any clean copy is verified');
  }
  const trunc = await inPage(page, 'hostile-trunc.jpg', async (f) => { const c = await LE.privacy.clean(f); const r = await LE.privacy.inspect(f); return { ok: c.ok, warn: r.warnings.length, summary: r.summary }; });
  h.assert(!trunc.ok && trunc.warn && !/^Nothing sensitive/.test(trunc.summary), 'a cut-short photo is not called clean and gets no broken copy');
  const bomb = await inPage(page, 'hostile-bomb.png', async (f) => { const r = await LE.privacy.inspect(f); return r.items.find((i) => i.key === 'png.comment').value.length; });
  h.assert(bomb <= 600, 'decompression is capped and long text is trimmed');
  /* Through the page UI: every value lands as text. */
  await page.evaluate(() => { window.__pwned = 0; });
  await page.setInputFiles('#pp-drop input[type=file]', HOSTILE.map((f) => path.join(FIX, f)));
  await page.waitForFunction((n) => document.querySelectorAll('.pp-photo:not(.is-loading)').length === n, HOSTILE.length, { timeout: 20000 });
  const dom = await page.evaluate(() => ({
    pwned: window.__pwned, onerror: document.querySelectorAll('[onerror]').length, scripts: [...document.querySelectorAll('#pp-list script')].length,
    make: [...document.querySelectorAll('.pp-row[data-key="exif.make"] .pp-val')].map((n) => n.textContent),
    bidi: /[‪-‮]/.test(document.getElementById('pp-list').textContent)
  }));
  h.assert.equal(dom.pwned, 0, 'no script ran');
  h.assert.equal(dom.onerror + dom.scripts, 0, 'no markup was injected');
  h.assert(dom.make.indexOf('<img src=x onerror="window.__pwned=1">') >= 0, 'hostile text is shown as text');
  h.assert(!dom.bidi, 'bidi override characters are removed');
  h.assert.noErrors(page);
};

cases['clean copy: metadata gone, image data byte-identical, orientation kept, re-parses clean'] = async ({ browser, base, h }) => {
  const page = await openTool(h, browser, base, 'desktop');
  for (const name of ['full.jpg', 'gps-only.jpg', 'meta.png', 'meta.webp']) {
    const r = await inPage(page, name, async (file) => {
      function chunks(b, kind) {
        const out = [];
        if (kind === 'png') { let o = 8; while (o + 12 <= b.length) { const len = (b[o] << 24 >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; const t = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]); if (t === 'IDAT') out.push(...b.subarray(o + 8, o + 8 + len)); o += 12 + len; } }
        else { let o = 12; while (o + 8 <= b.length) { const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); const len = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24); if (/^(VP8 |VP8L|ALPH)$/.test(id)) out.push(...b.subarray(o + 8, o + 8 + len)); o += 8 + len + (len & 1); } }
        return out.join(',');
      }
      async function look(blob) {
        const u = URL.createObjectURL(blob);
        const img = new Image(); img.src = u; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3));
        return { w: c.width, h: c.height, tl: px(8, 8), tr: px(c.width - 8, 8), br: px(c.width - 8, c.height - 8) };
      }
      const before = new Uint8Array(await file.arrayBuffer());
      const out = {};
      for (const keep of ['none', 'date', 'nolocation']) {
        const c = await LE.privacy.clean(file, { keep });
        const after = c.bytes;
        let same;
        if (c.before.container === 'jpeg') same = LE.privacy.sameBytes(LE.privacy.scanData(before), LE.privacy.scanData(after));
        else same = chunks(before, c.before.container) === chunks(after, c.before.container);
        const left = c.after.items.filter((i) => i.group !== 'file' && !i.derived).map((i) => i.key).sort();
        out[keep] = { ok: c.ok, verified: c.verified, same, identical: c.identical, removed: c.removed, left, where: c.after.items.filter((i) => i.group === 'where').length, orient: c.after.orientation, name: c.name };
      }
      const c0 = await LE.privacy.clean(file, { keepIcc: false });
      out.noIcc = c0.after.items.filter((i) => i.group !== 'file').map((i) => i.key);
      out.lookBefore = await look(file);
      out.lookAfter = await look(c0.blob);
      out.orient = (await LE.privacy.inspect(file)).orientation;
      return out;
    });
    const none = r.none;
    h.assert(none.ok && none.verified, name + ': clean copy made and verified');
    h.assert(none.same && none.identical, name + ': compressed image data is byte-identical');
    h.assert.equal(JSON.stringify(none.left), JSON.stringify(EXPECTED[name].icc ? ['icc'] : []), name + ': only the colour profile is left by default');
    h.assert(none.removed >= Object.keys(EXPECTED[name]).filter((k) => k[0] !== '_' && k !== 'icc').length, name + ': removed count');
    h.assert.equal(JSON.stringify(r.noIcc), '[]', name + ': nothing is left with the colour profile off');
    h.assert.equal(none.orient, r.orient, name + ': orientation is kept');
    h.assert.equal(JSON.stringify([r.lookAfter.w, r.lookAfter.h]), JSON.stringify([r.lookBefore.w, r.lookBefore.h]), name + ': shown the same way up');
    ['tl', 'tr', 'br'].forEach((k) => r.lookBefore[k].forEach((v, i) => h.assert(Math.abs(v - r.lookAfter[k][i]) <= 2, name + ': same pixels at ' + k)));
    h.assert(r.date.verified && r.date.same, name + ': keep-the-date copy verified');
    h.assert(r.date.left.every((k) => /^(exif\.taken|exif\.tz|icc)$/.test(k)), name + ': keep-the-date leaves only the date: ' + r.date.left);
    if (EXPECTED[name]['exif.taken']) h.assert(r.date.left.indexOf('exif.taken') >= 0, name + ': the capture date is kept');
    h.assert(r.nolocation.verified && r.nolocation.same && r.nolocation.where === 0, name + ': remove-location-only copy has no location');
    h.assert(/-clean\.(jpg|png|webp)$/.test(none.name), name + ': file name');
  }
  const full = await inPage(page, 'full.jpg', async (file) => { const c = await LE.privacy.clean(file); return LE.privacy.inspect(c.blob).then((r) => ({ o: r.orientation, w: r.width, h: r.height, n: c.after.items.filter((i) => i.key === 'file.orientation').length })); });
  h.assert(full.o === 6 && full.n === 1, 'the sideways photo keeps its rotation flag so it shows upright');
  const heic = await inPage(page, 'fake.heic', async (f) => { const c = await LE.privacy.clean(f); return { ok: c.ok, reason: c.reason }; });
  h.assert(!heic.ok && /HEIC/.test(heic.reason), 'HEIC: says honestly that it cannot be cleaned here');
  h.assert.noErrors(page);
};

cases['page: batch report, clean all, zip download, share card, no outside requests'] = async ({ browser, base, h }) => {
  const page = await openTool(h, browser, base, 'desktop');
  const files = ['full.jpg', 'meta.png', 'meta.webp', 'clean.jpg'];
  await page.setInputFiles('#pp-drop input[type=file]', files.map((f) => path.join(FIX, f)));
  await page.waitForFunction(() => document.querySelectorAll('.pp-photo:not(.is-loading)').length === 4);
  const shown = await page.evaluate(() => ({
    total: document.getElementById('pp-total').textContent,
    maps: document.querySelectorAll('.pp-map').length, previews: document.querySelectorAll('.pp-preview img').length,
    ok: [...document.querySelectorAll('.pp-badge.is-none')].length, high: document.querySelectorAll('.pp-badge.is-high').length,
    go: document.getElementById('pp-go').textContent, golds: document.querySelectorAll('.pp-app .btn-gold:not([hidden])').length
  }));
  h.assert(/4 photos checked\. 3 show where they were taken/.test(shown.total), 'batch summary: ' + shown.total);
  h.assert.equal(shown.maps, 3, 'a small offline map for each photo with a location');
  h.assert.equal(shown.previews, 1, 'the hidden preview is shown');
  h.assert.equal(shown.ok, 1, 'the clean photo gets a calm nothing-found badge');
  h.assert.equal(shown.golds, 1, 'one gold action in the tool');
  (await h.inkContrast(page, '#pp-go')).forEach((c) => h.assert(c.ratio >= 4.5, 'primary button text ' + c.color + ' on ' + c.bg + ' is ' + c.ratio + ':1'));
  await page.click('#pp-go');
  await page.waitForFunction(() => document.querySelectorAll('.pp-done').length === 4, null, { timeout: 15000 });
  const after = await page.evaluate(() => ({ go: document.getElementById('pp-go').textContent, lines: [...document.querySelectorAll('.pp-done-line')].map((n) => n.textContent), card: !document.getElementById('pp-cardbox').hidden }));
  h.assert(/Download all \(4\) as zip/.test(after.go), 'the gold button becomes download: ' + after.go);
  h.assert(/^\d+ details removed, image quality unchanged, [\d.]+ KB → [\d.]+ KB$/.test(after.lines[0]), 'before / after line: ' + after.lines[0]);
  h.assert(after.card, 'share card offered');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pp-go')]);
  const zip = zipEntries(fs.readFileSync(await dl.path()));
  h.assert.equal(dl.suggestedFilename(), 'clean-photos.zip');
  h.assert.equal(JSON.stringify(zip.map((e) => e.name)), JSON.stringify(['full-clean.jpg', 'meta-clean.png', 'meta-clean.webp', 'clean-clean.jpg']), 'zip holds every clean copy');
  for (const e of zip) {
    const left = await page.evaluate(async (b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
      const r = await LE.privacy.parse(u, {});
      return r.items.filter((i) => i.group !== 'file' && i.key !== 'icc').map((i) => i.key);
    }, Buffer.from(e.data).toString('base64'));
    h.assert.equal(left.length, 0, e.name + ' in the zip re-parses clean');
  }
  /* The share card names kinds of details, never values. */
  const card = await page.evaluate(() => {
    const items = window.LEPhotoPrivacy.items().map((it) => it.result);
    const c = LE.privacy.card(items);
    return { w: c.width, h: c.height };
  });
  h.assert(card.w === 1080 && card.h === 1080, 'share card is a square image');
  /* Changing what to keep re-cleans. */
  await page.click('#pp-keep button[data-v="nolocation"]');
  await page.waitForFunction(() => document.querySelectorAll('.pp-done').length === 4 && /Download/.test(document.getElementById('pp-go').textContent), null, { timeout: 15000 });
  const kept = await page.evaluate(() => window.LEPhotoPrivacy.items()[0].result.kept.length);
  h.assert(kept > 5, 'remove-location-only keeps the other details');
  h.assert.equal(page.foreign.length, 0, 'no requests to other origins: ' + page.foreign.join(', '));
  h.assert.noErrors(page);
};

cases['phone 360 and 390: report and clean flow, no sideways scroll, 44px targets'] = async ({ browser, base, h }) => {
  for (const vp of ['small', 'phone']) {
    const page = await openTool(h, browser, base, vp, { colorScheme: 'dark' });
    await page.setInputFiles('#pp-drop input[type=file]', [path.join(FIX, 'full.jpg'), path.join(FIX, 'clean.jpg')]);
    await page.waitForFunction(() => document.querySelectorAll('.pp-photo:not(.is-loading)').length === 2);
    h.assert(await h.noOverflow(page), vp + ': no sideways scroll on the report');
    await page.tap('#pp-go');
    await page.waitForFunction(() => document.querySelectorAll('.pp-done').length === 2);
    h.assert(await h.noOverflow(page), vp + ': no sideways scroll after cleaning');
    const small = await page.evaluate(() => [...document.querySelectorAll('.pp-app button, .pp-app .btn')].filter((b) => b.offsetParent && !b.closest('.dropzone')).map((b) => [b.textContent.trim() || b.getAttribute('aria-label'), b.getBoundingClientRect().height]).filter((x) => x[1] < 43.5));
    h.assert.equal(JSON.stringify(small), '[]', vp + ': touch targets are 44px or more');
    h.assert.equal(page.foreign.length, 0, 'no requests to other origins');
    h.assert.noErrors(page);
  }
};

cases['tool is registered: build list, homepage directory, studio Metadata app'] = async ({ browser, base, h }) => {
  const build = fs.readFileSync(path.join(h.ROOT, 'scripts', 'build.js'), 'utf8');
  h.assert(/\['image', 'photo-privacy', 'Photo Privacy Check'/.test(build), 'listed in scripts/build.js');
  const home = fs.readFileSync(path.join(h.ROOT, 'index.html'), 'utf8');
  h.assert(/class="hp-tool" href="photo-privacy\/"/.test(home), 'listed in the homepage directory');
  const html = fs.readFileSync(path.join(h.ROOT, 'photo-privacy', 'index.html'), 'utf8');
  h.assert(/<link rel="canonical" href="https:\/\/localeditor\.net\/photo-privacy\/">/.test(html) && /"@type":"FAQPage"/.test(html), 'canonical and FAQ');
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(async () => {
    const c = window.LEStudio;
    const blob = await (await fetch('/tests/fixtures/privacy/full.jpg')).blob();
    const meta = await c.ingest(new File([blob], 'full.jpg', { type: 'image/jpeg' }));
    c.placeImage ? c.placeImage(meta.id) : c.scene.add({ type: 'image', src: meta.id, x: 0, y: 0, w: 300, h: 400 });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const c = window.LEStudio; const l = c.scene.layers().filter((x) => x.type === 'image').pop(); c.scene.select([l.id]); });
  await h.openPanel(page, 'apps', { app: 'metadata' });
  await page.waitForFunction(() => document.querySelector('.sxp-sum'), null, { timeout: 8000 });
  const m = await page.evaluate(() => ({ sum: document.querySelector('.sxp-sum').textContent, link: document.querySelector('.sxp-link').getAttribute('href') }));
  h.assert(/where and when it was taken/.test(m.sum), 'Metadata app shows the privacy summary: ' + m.sum);
  h.assert.equal(m.link, '../photo-privacy/', 'and links to the full check');
  h.assert.noErrors(page);
};

module.exports = cases;
