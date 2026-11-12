'use strict';
/* Process replay: recorded timeline and layer-build fallback both give a playable video of about the requested length;
   the open document is never changed; the timeline stays within its caps; frame-zip fallback when recording is missing. */
const { unzip, dims } = require('./export.test.js')._lib;

async function edits(page) {
  await page.evaluate(async () => {
    const c = window.LEStudio;
    const wait = () => new Promise((r) => setTimeout(r, 300));
    c.addText({ text: 'Golden hour', size: 120 }); await wait();
    c.addText({ text: 'a quiet evening walk', size: 48 }); await wait();
    const ls = c.scene.layers();
    c.scene.update(ls[ls.length - 1].id, { y: 600 }); await wait();
    c.scene.update(ls[ls.length - 2].id, { color: '#ffffff' }); await wait();
  });
}
/* Makes a replay in the page and measures the resulting video by playing its metadata. */
function measure(page, opts) {
  return page.evaluate(async (opts) => {
    const c = window.LEStudio;
    const before = JSON.stringify(c.scene.toJSON());
    const r = await LEStudioExport.replay.export(c, opts);
    const same = before === JSON.stringify(c.scene.toJSON());
    if (r.frames) return { frames: true, size: r.blob.size, same, mode: r.mode };
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(r.blob);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('not playable: ' + (v.error && v.error.message))); });
    let dur = v.duration;
    if (!isFinite(dur)) { v.currentTime = 1e6; await new Promise((res) => { v.ontimeupdate = res; }); dur = v.duration; }
    v.currentTime = Math.max(0, dur - 0.3);
    await new Promise((res) => { v.onseeked = res; });
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
    const x = cv.getContext('2d'); x.drawImage(v, 0, 0);
    const px = x.getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data;
    return { mode: r.mode, type: r.blob.type, ext: r.ext, size: r.blob.size, dur, w: v.videoWidth, h: v.videoHeight, same, painted: px[3] === 255 && (px[0] + px[1] + px[2]) > 0 };
  }, opts);
}

const cases = {};

cases['recorded timeline plays back as a video of about the requested length; doc unchanged'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await edits(page);
  const st = await page.evaluate(() => LEStudioExport.replay.stats(window.LEStudio));
  h.assert(st.steps >= 4, 'edits were recorded: ' + st.steps);
  h.assert(st.bytes < 64 * 1024, 'timeline is small: ' + st.bytes);
  const r = await measure(page, { length: 6, hold: 1 });
  h.assert.equal(r.mode, 'timeline');
  h.assert(r.size > 10000, 'non-empty video: ' + r.size);
  h.assert(/^video\/(mp4|webm)$/.test(r.type), 'video type ' + r.type);
  h.assert(Math.abs(r.dur - 6) < 1.5, 'about 6 s: ' + r.dur);
  h.assert(r.w % 2 === 0 && r.h % 2 === 0 && Math.abs(r.w / r.h - 1.5) < 0.01, 'design aspect, even size: ' + r.w + 'x' + r.h);
  h.assert(r.painted, 'last frame has the design');
  h.assert(r.same, 'open document unchanged');
  h.assert.noErrors(page);
};

cases['designs without a timeline build layer by layer; WebM is offered too'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await page.evaluate(() => {
    const c = window.LEStudio;
    c.newDesign(1080, 1350, 'Poster');
    c.addText({ text: 'Poster', size: 140 });
    c.addShape('ellipse');
    LEStudioExport.replay.clear(c);
  });
  const plan = await page.evaluate(() => LEStudioExport.replay.plan(window.LEStudio, { length: 6 }));
  h.assert.equal(plan.mode, 'build', 'no timeline → layer build');
  h.assert(plan.width === 864 || plan.width === 1080 * Math.min(1, 1080 / 1350), 'cap applies: ' + plan.width);
  const types = await page.evaluate(() => LEStudioExport.replay.types().map((t) => t.ext));
  h.assert(types.includes('webm'), 'webm available: ' + types);
  const r = await measure(page, { length: 6, hold: 1, container: 'webm' });
  h.assert.equal(r.mode, 'build');
  h.assert.equal(r.type, 'video/webm');
  h.assert(Math.abs(r.dur - 6) < 1.5, 'about 6 s: ' + r.dur);
  h.assert(r.same, 'open document unchanged');
  h.assert.noErrors(page);
};

cases['timeline is capped by count and bytes and thins old steps'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const r = await page.evaluate(() => {
    const c = window.LEStudio, L = LEStudioExport.replay.limits;
    const keep = [L.maxSteps, L.maxBytes, L.coalesceMs];
    L.maxSteps = 20; L.coalesceMs = 0;
    c.addText({ text: 'Count', size: 60 });
    const id = c.scene.layers().slice(-1)[0].id;
    const first = LEStudioExport.replay.steps(c)[0];
    for (let i = 0; i < 80; i++) { c.scene.update(id, { x: 10 + i * 5 }); LEStudioExport.replay.record(c); }
    const s1 = LEStudioExport.replay.stats(c);
    const steps = LEStudioExport.replay.steps(c);
    L.maxSteps = 1000; L.maxBytes = 20000;
    for (let i = 0; i < 80; i++) { c.scene.update(id, { y: 10 + i * 5 }); LEStudioExport.replay.record(c); }
    const s2 = LEStudioExport.replay.stats(c);
    L.maxSteps = keep[0]; L.maxBytes = keep[1]; L.coalesceMs = keep[2];
    const noBitmaps = !JSON.stringify(steps).includes('data:image');
    return { s1, s2, firstKept: JSON.stringify(steps[0]) === JSON.stringify(first), lastX: steps[steps.length - 1].layers.find((l) => l.id === id).x, noBitmaps };
  });
  h.assert(r.s1.steps <= 20 && r.s1.thinned > 0, 'count cap: ' + JSON.stringify(r.s1));
  h.assert(r.firstKept, 'first step kept');
  h.assert.equal(r.lastX, 10 + 79 * 5, 'latest step kept');
  h.assert(r.s2.bytes <= 20000, 'byte cap: ' + r.s2.bytes);
  h.assert(r.noBitmaps, 'no pixels in the timeline');
  h.assert.noErrors(page);
};

cases['without a recorder the replay is a zip of frames; the panel previews and downloads the video'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'phone');
  const z = await page.evaluate(async () => {
    const r = await LEStudioExport.replay.export(window.LEStudio, { length: 6, hold: 0.5, frames: true, fps: 4 });
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    return { name: r.name, n: buf.length, b64: btoa(Array.from(buf.subarray(0, Math.min(buf.length, 2e6)), (c) => String.fromCharCode(c)).join('')) };
  });
  const files = unzip(Buffer.from(z.b64, 'base64'));
  h.assert(files.length >= 20 && files.length <= 30, 'about 24 frames: ' + files.length);
  h.assert(files[0].name === 'frame-0001.jpg' && dims(files[0].data).type === 'jpeg', 'jpeg frames');
  await page.evaluate(() => { const o = window.LEStudio.lsGet('le-studio-replay', {}); window.LEStudio.lsSet('le-studio-replay', Object.assign(o, { length: 6, hold: 0.5 })); });
  await h.openPanel(page, 'export', { tab: 'replay' });
  h.assert(!(await page.isChecked('#sx-panel-body .sx-toggle:has-text("Made with LocalEditor") input')), 'end tag off by default');
  await page.click('#sx-panel-body .sxe-make');
  await page.waitForSelector('#sx-panel-body video.sxe-video', { timeout: 30000 });
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sx-panel-body [data-act="download"]')]);
  h.assert(/^sample-scene-replay\.(mp4|webm)$/.test(dl.suggestedFilename()), 'video file name ' + dl.suggestedFilename());
  h.assert.noErrors(page);
};

module.exports = cases;
