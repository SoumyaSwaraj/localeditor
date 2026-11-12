'use strict';
/* Remix links: a template in the URL fragment (#d=…). Encode/decode, photos → empty slots, tamper and size
   rejection, the "Shared template" sheet that only applies on confirm, and the share dialog. */
const fs = require('fs');
const path = require('path');

const EX = (f) => fs.readFileSync(path.join(__dirname, '..', 'examples', 'designs', f), 'utf8');
const cases = {};

async function studio(browser, base, h, vp, url) {
  const page = await h.open(browser, base, url || '/studio/', vp || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.design);
  return page;
}

cases['link round trip keeps the template and turns photos into empty slots'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(async (carousel) => {
    const c = window.LEStudio;
    const b = c.baseLayer();
    c.scene.update(b.id, { radius: 40, border: { width: 12, color: '#ffffff' }, mask: 'ellipse', crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, name: 'Hero shot', adjust: { warmth: 12 } });
    c.addText({ text: 'Template text' });
    c.syncProject();
    const link = await LE.design.toLink(c.S.project, { by: 'Ana <b>R</b>' });
    const back = await LE.design.fromLink(link.url);
    const L = back.project.pages[0].layers;
    const hero = L.find((l) => l.id === b.id);
    // Example designs: decoded link equals the original template (minus the remix credit).
    const a = await LE.design.parse(carousel);
    const link2 = await LE.design.toLink(a.project);
    const back2 = await LE.design.fromLink('#d=' + link2.payload);
    const strip = (p) => { const t = JSON.parse(LE.design.stringify(p, { images: 'none' }).text); delete t.remix; return JSON.stringify(t); };
    const sup = (window.LE_SUPPORT_DEFS || []).map((d) => d.id);
    return {
      fits: link.fits, compressed: link.compressed, hasD: /\/studio\/#d=z[A-Za-z0-9_-]+$/.test(link.url), dropped: link.dropped, ok: back.ok,
      assets: Object.keys(back.project.assets).length, hero, credit: back.project.meta.studio.remix, text: L.some((l) => l.type === 'text' && l.text === 'Template text'),
      same: strip(a.project) === strip(back2.project), pages: back2.project.pages.length, sup, noBitmap: !/data:image/.test(link.url)
    };
  }, EX('tips-carousel.ledesign.json'));
  h.assert(r.ok && r.fits && r.compressed && r.hasD, 'link made and decoded: ' + JSON.stringify(r).slice(0, 200));
  h.assert(r.noBitmap, 'no bitmap in the link');
  h.assert.equal(r.assets, 0, 'no photos travel in the link');
  h.assert(/photo/.test(r.dropped.join(' ')), 'the share dialog can say what was left out');
  h.assert.equal(r.hero.src, '', 'photo became an empty slot');
  h.assert(r.hero.slot && r.hero.slot.label === 'Hero shot', 'slot keeps the label');
  h.assert.equal(r.hero.radius, 40); h.assert.equal(r.hero.mask, 'ellipse'); h.assert.equal(r.hero.border.width, 12);
  h.assert.equal(JSON.stringify(r.hero.crop), JSON.stringify({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }), 'crop intent kept');
  h.assert.equal(r.hero.adjust.warmth, 12, 'the look stays for the next photo');
  h.assert(r.text, 'text kept');
  h.assert.equal(r.credit.by, 'Ana bR/b', 'credit is sanitised plain text');
  h.assert(r.same && r.pages === 4, 'multi-page example survives the link unchanged');
  h.assert(r.sup.includes('design.remix-link') && r.sup.includes('design.share'), 'support defs declared');
  h.assert.noErrors(page);
};

cases['tampered, oversized and hostile links are refused'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (hello) => {
    const a = await LE.design.parse(hello);
    const good = await LE.design.toLink(a.project);
    const p = good.payload;
    const flip = p.slice(0, 20) + (p[20] === 'A' ? 'B' : 'A') + p.slice(21);
    const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    async function deflate(bytes) {
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
      let bin = ''; const u = new Uint8Array(out); for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    const bomb = 'z' + await deflate(new TextEncoder().encode(' '.repeat(2 * 1024 * 1024)));
    const script = 'j' + b64(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ layers: [{ id: 't', type: 'text', text: '<script>alert(1)</script>', w: 10 }] }] }));
    const photo = 'j' + b64(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 100, height: 100, layers: [{ id: 'p', type: 'image', src: 'https://evil.example/x.png', w: 10, h: 10 }] }] }));
    const tries = { flip: '#d=' + flip, cut: '#d=' + p.slice(0, Math.floor(p.length / 2)), junk: '#d=zzzz', tag: '#d=q' + p.slice(1), huge: '#d=z' + 'A'.repeat(LE.design.LIMITS.linkChars + 10), bomb: '#d=' + bomb, script: '#d=' + script, empty: '#x=1' };
    const out = {};
    for (const k of Object.keys(tries)) { const res = await LE.design.fromLink(tries[k]); out[k] = { ok: res.ok, msg: res.errors[0] && res.errors[0].message }; }
    const ph = await LE.design.fromLink('#d=' + photo);
    out.photo = { ok: ph.ok, src: ph.ok && ph.project.pages[0].layers[0].src, remote: ph.remote.length, warn: ph.warnings.map((w) => w.kind) };
    return out;
  }, EX('hello-world.ledesign.json'));
  ['flip', 'cut', 'junk', 'tag', 'huge', 'bomb', 'script', 'empty'].forEach((k) => {
    h.assert(!r[k].ok, k + ' link should be refused');
    h.assert(r[k].msg && !/undefined|Error:/.test(r[k].msg), k + ' needs a friendly message: ' + r[k].msg);
  });
  h.assert(/too large/.test(r.huge.msg) && /too large/.test(r.bomb.msg), 'size caps');
  h.assert(r.photo.ok && r.photo.src === '' && r.photo.remote === 0 && r.photo.warn.includes('link-image'), 'images in a link are dropped, never fetched');
  h.assert.noErrors(page);
};

cases['opening a #d= link shows the shared-template sheet and applies only on confirm'] = async ({ browser, base, h }) => {
  const maker = await studio(browser, base, h);
  const link = await maker.evaluate(async (yt) => {
    const a = await LE.design.parse(yt);
    a.project.meta.studio.remix = { name: 'Thumb', by: 'Jo' };
    return (await LE.design.toLink(a.project)).payload;
  }, EX('youtube-thumbnail.ledesign.json'));
  // A person with a design already open.
  const page = await h.studioWithSample(browser, base, 'desktop');
  const before = await page.evaluate(() => ({ id: window.LEStudio.S.project.id, n: window.LEStudio.scene.layers().length }));
  await page.evaluate((p) => { location.hash = 'd=' + p; }, link);
  await page.waitForSelector('.sxd-sheet .sxd-preview canvas');
  const sheet = await page.evaluate(() => ({ text: document.querySelector('.sxd-sheet').textContent, id: window.LEStudio.S.project.id, n: window.LEStudio.scene.layers().length, gold: getComputedStyle(document.querySelector('.sxd-sheet [data-yes]')).color }));
  h.assert(/YouTube thumbnail/.test(sheet.text) && /1 page/.test(sheet.text) && /1 photo slot/.test(sheet.text) && /Originally by Jo/.test(sheet.text), 'sheet shows name, pages, slots, credit: ' + sheet.text);
  h.assert.equal(sheet.id, before.id, 'nothing replaced before confirming');
  h.assert.equal(sheet.n, before.n, 'open design unchanged');
  h.assert.equal(sheet.gold, 'rgb(42, 31, 10)', 'gold button ink');
  await page.click('.sxd-sheet [data-no]');
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => window.LEStudio.S.project.id), before.id, 'Cancel keeps the design');
  h.assert.equal(await page.evaluate(() => location.hash), '', 'hash cleared');
  // Fresh visit straight to the link, then "Use this template".
  const fresh = await studio(browser, base, h, 'phone', '/studio/#d=' + link);
  await fresh.waitForSelector('.sxd-sheet [data-yes]');
  await fresh.waitForTimeout(300);
  h.assert(await h.noOverflow(fresh), 'sheet scrolls sideways on a phone');
  await fresh.click('.sxd-sheet [data-yes]');
  await fresh.waitForFunction(() => window.LEStudio.S.project && window.LEStudio.scene.layers().some((l) => l.id === 'line-1'));
  const used = await fresh.evaluate(() => ({ slot: window.LEStudio.scene.layers().find((l) => l.id === 'photo'), remix: window.LEStudio.S.project.meta.studio.remix, hash: location.hash }));
  h.assert(used.slot && used.slot.slot && used.slot.src === '', 'photo slot is empty and ready');
  h.assert.equal(used.remix.by, 'Jo', 'credit kept with the new design');
  h.assert.equal(used.hash, '');
  h.assert.noErrors(page); h.assert.noErrors(fresh);
};

cases['a broken link shows a friendly message and changes nothing'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h, 'desktop', '/studio/#d=zNotARealPayload');
  await page.waitForSelector('.sxd-ask [data-ok]');
  const r = await page.evaluate(() => ({ text: document.querySelector('.sx-modal').textContent, project: !!window.LEStudio.S.project }));
  h.assert(/can’t be opened/.test(r.text) && /damaged/.test(r.text), 'friendly message: ' + r.text);
  h.assert(!r.project, 'no design was created');
  h.assert.noErrors(page);
};

cases['share dialog: size meter, copy, QR, file fallback, phone width'] = async ({ browser, base, h }) => {
  for (const vp of ['desktop', 'small']) {
    const page = await studio(browser, base, h, vp);
    await page.evaluate((t) => LE.design.importText(window.LEStudio, t, { name: 'hello' }), EX('hello-world.ledesign.json'));
    await page.waitForFunction(() => window.LEStudio.S.project && window.LEStudio.S.project.name === 'Hello world');
    await page.evaluate(() => { window.LEStudio.cmd('fileMenu', document.querySelector('.sx-file-btn')); });
    await page.click('[data-cmd="shareTemplate"]');
    await page.waitForSelector('.sxd-qr svg');
    const r = await page.evaluate(() => ({
      fit: document.querySelector('[data-fit]').textContent, url: document.querySelector('.sxd-linkrow input').value,
      note: document.querySelector('.sxd-photo-note').textContent, copyGold: document.querySelector('[data-copy]').classList.contains('btn-gold'),
      golds: document.querySelectorAll('.sxd-share .btn-gold').length
    }));
    h.assert.equal(r.fit, 'Fits in a link');
    h.assert(/\/studio\/#d=/.test(r.url), 'link shown');
    h.assert(/Photos are not included/.test(r.note), 'photo note');
    h.assert(r.copyGold && r.golds === 1, 'one gold action');
    if (vp === 'small') h.assert(await h.noOverflow(page), 'share dialog scrolls sideways at 360');
    // Credit updates the link.
    await page.fill('[data-by]', 'Sam');
    await page.waitForFunction((u) => document.querySelector('.sxd-linkrow input').value !== u, r.url);
    const dec = await page.evaluate(() => LE.design.fromLink(document.querySelector('.sxd-linkrow input').value).then((x) => x.project.meta.studio.remix.by));
    h.assert.equal(dec, 'Sam', 'credit in link');
    h.assert.noErrors(page);
    await page.context().close();
  }
  // Too large: a design with lots of text beyond the link cap falls back to the file.
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const layers = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed; };
    for (let i = 0; i < 400; i++) layers.push({ id: 't' + i, type: 'text', text: Array.from({ length: 12 }, () => rnd().toString(36)).join(' '), x: i, y: i, w: 300, h: 40 });
    await LE.design.importText(window.LEStudio, JSON.stringify({ format: 'localeditor-design', version: 1, name: 'Big', pages: [{ width: 1000, height: 1000, layers }] }), { name: 'big' });
    await LE.design.openShare(window.LEStudio);
    return { fit: document.querySelector('[data-fit]').textContent, copy: document.querySelector('[data-copy]').disabled, fileGold: document.querySelector('[data-file]').classList.contains('btn-gold'), over: !!document.querySelector('.sxd-meter.is-over') };
  });
  h.assert(/Too large for a link/.test(r.fit) && r.copy && r.fileGold && r.over, 'too-large state: ' + JSON.stringify(r));
  h.assert.noErrors(page);
};

module.exports = cases;
