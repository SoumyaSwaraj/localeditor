'use strict';
/* Export panel: every old path still downloads the right file; share sheet, clipboard, every-size zip, privacy of the bytes. */
const fs = require('fs');

/* ---------- byte helpers (shared by carousel/replay tests) ---------- */
function dims(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xC3) return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'webp', w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 }; }
    if (kind === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  if (buf.toString('ascii', 0, 4) === '%PDF') return { type: 'pdf' };
  return { type: 'unknown' };
}
/* Stored (uncompressed) zips, as LE.zip writes them. */
function unzip(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nl);
    const data = buf.subarray(i + 30 + nl + xl, i + 30 + nl + xl + size);
    out.push({ name, data });
    i += 30 + nl + xl + size;
  }
  return out;
}
/* EXIF / XMP / GPS markers that a camera or editor would leave behind. */
function metadataMarkers(buf) {
  const found = [];
  const s = buf.toString('latin1');
  if (s.includes('Exif\u0000\u0000')) found.push('Exif');
  if (s.includes('http://ns.adobe.com/xap/')) found.push('XMP');
  if (s.includes('<x:xmpmeta')) found.push('xmpmeta');
  if (dims(buf).type === 'png' && (s.includes('eXIf') || s.includes('iTXtXML:com.adobe.xmp'))) found.push('png-meta');
  if (dims(buf).type === 'webp' && (s.includes('EXIF') || s.includes('XMP '))) found.push('webp-meta');
  return found;
}
async function grab(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(p) };
}
async function setOpts(page, o) {
  await page.evaluate((o) => { Object.assign(window.LEStudio.S.exportOpts, o); window.LEStudio.openPanel('export', { tab: 'image' }); }, o);
  await page.waitForTimeout(250);
}
const clickAct = (page, act) => () => page.click('#sx-panel-body .sxe-actions [data-act="' + act + '"]');

const cases = {};

cases['every old format downloads a real file of the right type and pixel size, with no metadata'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const d = await h.doc(page);
  for (const [format, scale, type] of [['png', 1, 'png'], ['jpeg', 1, 'jpeg'], ['webp', 1, 'webp'], ['png', 2, 'png'], ['jpeg', 0.5, 'jpeg']]) {
    await setOpts(page, { format, scale, pages: 'current', transparent: false });
    const f = await grab(page, clickAct(page, 'download'));
    const m = dims(f.buf);
    h.assert.equal(m.type, type, format + ' type');
    h.assert.equal(m.w, Math.round(d.width * scale), format + ' width');
    h.assert.equal(m.h, Math.round(d.height * scale), format + ' height');
    h.assert(f.name.endsWith('.' + (format === 'jpeg' ? 'jpg' : format)), 'extension ' + f.name);
    h.assert.equal(metadataMarkers(f.buf).length, 0, format + ' carries no EXIF/XMP: ' + metadataMarkers(f.buf));
  }
  const est = await page.textContent('.sx-export-info strong');
  h.assert(/\d+ × \d+ px/.test(est), 'estimate shows size: ' + est);
  await page.evaluate(() => window.LEStudio.lsSet('le-studio-export', { format: 'png', quality: 0.92, scale: 1, transparent: false, pages: 'current' }));
  h.assert.noErrors(page);
};

cases['transparent PNG leaves the background out; PDF of all pages and the pages zip still work'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => { const c = window.LEStudio; c.newDesign(400, 300, 'Clear test'); c.addText({ text: 'Hi', size: 40 }); });
  await page.waitForTimeout(300);
  await setOpts(page, { format: 'png', scale: 1, transparent: true, pages: 'current' });
  const t = await grab(page, clickAct(page, 'download'));
  const alpha = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const x = cv.getContext('2d'); x.drawImage(bmp, 0, 0);
    return x.getImageData(2, 2, 1, 1).data[3];
  }, t.buf.toString('base64'));
  h.assert.equal(alpha, 0, 'corner is transparent');
  await page.evaluate(() => window.LEStudio.addPage(true));
  await page.waitForTimeout(300);
  await setOpts(page, { format: 'pdf', scale: 1, transparent: false, pages: 'all' });
  const pdf2 = await grab(page, clickAct(page, 'download'));
  h.assert.equal(dims(pdf2.buf).type, 'pdf', 'pdf');
  h.assert(pdf2.name === 'clear-test.pdf', 'pdf name ' + pdf2.name);
  await setOpts(page, { format: 'pdf', pages: 'current' });
  const pdf1 = await grab(page, clickAct(page, 'download'));
  h.assert(pdf2.buf.length > pdf1.buf.length * 1.3, 'two-page pdf is bigger than one page');
  await setOpts(page, { format: 'png', pages: 'all', transparent: false });
  const z = await grab(page, clickAct(page, 'download'));
  const files = unzip(z.buf);
  h.assert.equal(files.length, 2, 'two pages in the zip');
  h.assert(files.every((f) => dims(f.data).w === 400 && dims(f.data).h === 300), 'pages are 400×300');
  h.assert.equal(files[0].name, 'clear-test-page-1.png');
  await page.evaluate(() => window.LEStudio.lsSet('le-studio-export', { format: 'png', quality: 0.92, scale: 1, transparent: false, pages: 'current' }));
  h.assert.noErrors(page);
};

cases['Copy image puts a PNG on the clipboard, and a refusal is explained'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop', { permissions: ['clipboard-read', 'clipboard-write'] });
  await setOpts(page, { format: 'jpeg', scale: 1 });
  await page.click('#sx-panel-body .sxe-row:has-text("Copy image")');
  await page.waitForFunction(() => /Copied/.test(document.getElementById('sx-toast').textContent), null, { timeout: 15000 });
  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const b = await items[0].getType('image/png');
    const bmp = await createImageBitmap(b);
    return { types: items[0].types, w: bmp.width, h: bmp.height };
  });
  const d = await h.doc(page);
  h.assert(clip.types.includes('image/png'), 'png on clipboard');
  h.assert(clip.w === d.width && clip.h === d.height, 'clipboard image is the page size');
  await page.evaluate(() => { navigator.clipboard.write = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })); });
  await page.click('#sx-panel-body .sxe-row:has-text("Copy image")');
  await page.waitForFunction(() => /Could not copy/.test(document.getElementById('sx-toast').textContent), null, { timeout: 10000 });
  /* No image clipboard at all: the row stays visible and says why. */
  await page.evaluate(() => { delete window.ClipboardItem; window.LEStudio.openPanel('export', { tab: 'image' }); });
  await page.waitForTimeout(200);
  const row = await page.textContent('#sx-panel-body .sxe-row:has-text("Copy image")');
  h.assert(/Not available in this browser/.test(row), 'explains: ' + row);
  await page.evaluate(() => window.LEStudio.lsSet('le-studio-export', { format: 'png', quality: 0.92, scale: 1, transparent: false, pages: 'current' }));
  h.assert.noErrors(page);
};

cases['Share hands files to the share sheet when it can, and falls back to download otherwise'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'phone');
  await page.evaluate(() => {
    window.__shared = [];
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = (d) => { window.__shared.push({ n: d.files.length, type: d.files[0].type, name: d.files[0].name, size: d.files[0].size }); return Promise.resolve(); };
  });
  await setOpts(page, { format: 'png', scale: 1, pages: 'current' });
  const gold = await page.getAttribute('#sx-panel-body .sxe-actions .btn-gold', 'data-act');
  h.assert.equal(gold, 'share', 'on a phone that can share, Share is the gold action');
  await page.click('#sx-panel-body [data-act="share"]');
  await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 15000 });
  const s = await page.evaluate(() => window.__shared[0]);
  h.assert(s.n === 1 && s.type === 'image/png' && s.name === 'sample-scene.png' && s.size > 1000, 'shared one PNG: ' + JSON.stringify(s));
  /* The user closes the sheet: nothing is downloaded, no error. */
  const r = await page.evaluate(async () => { navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); return LEStudioExport.share(window.LEStudio, [new Blob(['x'], { type: 'image/png' })]); });
  h.assert.equal(r, 'cancelled');
  /* No file sharing: Share stays visible, explains, and offers Download instead. */
  await page.evaluate(() => { delete navigator.canShare; navigator.canShare = undefined; window.LEStudio.openPanel('export', { tab: 'image' }); });
  await page.waitForTimeout(250);
  h.assert.equal(await page.getAttribute('#sx-panel-body .sxe-actions .btn-gold', 'data-act'), 'download', 'Download is gold without share');
  h.assert(await page.isVisible('#sx-panel-body [data-act="share"]'), 'Share still visible');
  await page.click('#sx-panel-body [data-act="share"]');
  await page.waitForSelector('.sx-modal-card [data-fallback]');
  const f = await grab(page, () => page.click('.sx-modal-card [data-fallback]'));
  h.assert.equal(dims(f.buf).type, 'png', 'fallback downloaded the PNG');
  const api = await page.evaluate(() => LEStudioExport.share(window.LEStudio, [new Blob(['x'], { type: 'image/png' })]));
  h.assert.equal(api, 'unsupported');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  h.assert.noErrors(page);
};

cases['Every size: a zip of N correctly sized, correctly named images; the open page is untouched'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => window.LEStudio.lsSet('le-studio-export-sizes', { ids: ['ig-post', 'ig-story', 'yt-thumb'], custom: [], format: 'jpeg' }));
  const before = JSON.stringify(await h.doc(page));
  await h.openPanel(page, 'export', { tab: 'sizes' });
  await page.waitForFunction(() => document.querySelectorAll('.sxe-thumb.is-ready').length === 3, null, { timeout: 20000 });
  /* Custom size from the form. */
  await page.fill('.sxe-custom input >> nth=0', '640');
  await page.fill('.sxe-custom input >> nth=1', '200');
  await page.click('.sxe-custom button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.sxe-thumb.is-ready').length === 4, null, { timeout: 20000 });
  const z = await grab(page, clickAct(page, 'download'));
  h.assert.equal(z.name, 'sample-scene-sizes.zip');
  const files = unzip(z.buf);
  const got = files.map((f) => f.name + ':' + dims(f.data).w + 'x' + dims(f.data).h).sort();
  h.assert.equal(JSON.stringify(got), JSON.stringify([
    'sample-scene-custom-640x200.jpg:640x200',
    'sample-scene-instagram-post-1080x1080.jpg:1080x1080',
    'sample-scene-story-reel-1080x1920.jpg:1080x1920',
    'sample-scene-youtube-thumbnail-1280x720.jpg:1280x720'
  ]), 'zip contents');
  h.assert(files.every((f) => metadataMarkers(f.data).length === 0), 'no metadata in size exports');
  h.assert.equal(JSON.stringify(await h.doc(page)), before, 'open document unchanged');
  /* Adjust one size: the override changes only that size. */
  await page.click('.sxe-thumb >> nth=0');
  await page.waitForSelector('.sxe-detail img[src^="blob:"]');
  await page.click('.sxe-focal button >> nth=0');
  await page.click('.sx-modal-card button:has-text("Done")');
  await page.waitForTimeout(200);
  h.assert(/adjusted/.test(await page.textContent('.sxe-thumb >> nth=0')), 'marked adjusted');
  /* API with progress and cancel. */
  const r = await page.evaluate(async () => {
    const c = window.LEStudio, seen = [];
    const out = await LEStudioExport.renderSizes(c, [{ w: 300, h: 300, name: 'Tiny' }, c.SIZES[0]], { format: 'png', onProgress: (i, n) => seen.push(i + '/' + n) });
    const sig = { cancelled: true };
    let cancelled = false;
    try { await LEStudioExport.renderSizes(c, [c.SIZES[0]], { signal: sig }); } catch (e) { cancelled = !!e.cancelled; }
    return { names: out.map((o) => o.name + ' ' + o.width + 'x' + o.height + ' ' + o.blob.type), seen, cancelled };
  });
  h.assert.equal(r.names[0], 'sample-scene-tiny-300x300.png 300x300 image/png');
  h.assert(r.seen.join() === '0/2,1/2,2/2', 'progress ' + r.seen);
  h.assert(r.cancelled, 'cancel stops the run');
  h.assert.equal(JSON.stringify(await h.doc(page)), before, 'still unchanged');
  await page.evaluate(() => localStorage.removeItem('le-studio-export-sizes'));
  h.assert.noErrors(page);
};

cases['phone: every export tab fits 360 px with the primary action in reach'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'small');
  for (const tab of ['image', 'sizes', 'slides', 'replay']) {
    await h.openPanel(page, 'export', { tab });
    await page.waitForTimeout(300);
    h.assert(await h.noOverflow(page), tab + ': no sideways scroll');
    const box = await page.locator('#sx-panel-body .sxe-actions .btn-gold').boundingBox();
    h.assert(box && box.height >= 44, tab + ': gold action is 44px+');
    h.assert(box.y + box.height <= 740 && box.y > 740 / 2, tab + ': gold action in the lower half, on screen (' + Math.round(box.y) + ')');
    const small = await page.evaluate(() => [...document.querySelectorAll('#sx-panel-body button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 27 && !b.closest('.sx-seg') && !b.classList.contains('sxe-slide-x')).map((b) => b.textContent.trim()).slice(0, 3));
    h.assert.equal(small.length, 0, tab + ': tiny buttons ' + small);
  }
  h.assert.noErrors(page);
};

cases['template link row appears when the share dialog exists'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => { window.LE.design = window.LE.design || {}; window.__opened = 0; window.LE.design.openShare = () => { window.__opened++; }; window.LEStudio.openPanel('export', { tab: 'image' }); });
  await page.waitForTimeout(200);
  await page.click('#sx-panel-body .sxe-row:has-text("Share as template link")');
  h.assert.equal(await page.evaluate(() => window.__opened), 1);
  h.assert(/no camera metadata/.test(await page.textContent('#sx-panel-body .sxe-privacy')), 'privacy line');
  h.assert.noErrors(page);
};

module.exports = cases;
Object.defineProperty(module.exports, '_lib', { value: { dims, unzip, metadataMarkers, grab }, enumerable: false });
