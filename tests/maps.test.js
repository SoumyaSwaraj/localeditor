'use strict';
/* Maps lab (labs/maps/): the small depth model and the face models each run once on a pool photo, in a worker, with a clean console.
   Inputs are small (depth at 266 px, faces at 640 px) so every case stays well under the runner's 90 s limit. */
const cases = {};

const PHOTO = (name) => '/assets/photos/collage/' + name + '.jpg';

cases['lab loads nothing until asked'] = async ({ browser, base, h }) => {
  for (const url of ['/labs/maps/index.html', '/labs/maps/depth.html', '/labs/maps/face.html']) {
    const page = await h.open(browser, base, url, 'desktop');
    const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
    h.assert(!urls.some((u) => /\.wasm|\.onnx|ort[.-]|maps-worker/.test(u)), url + ' fetched the runtime or a model before the user asked: ' + urls.join(', '));
    h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), false, 'Model cache created before the user asked');
    h.assert(await page.evaluate(() => LE.maps.models().filter((m) => m.tier === 'standard').length >= 3), 'Standard models are registered');
    h.assert(await page.evaluate(() => LE.maps.models().every((m) => !/depth anything|mediapipe|u.?net|blazeface/i.test(m.label + m.bestFor + m.sizeLabel))), 'Plain-language labels name no network');
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['support definitions are declared with honest needs'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/index.html', 'desktop');
  const defs = await page.evaluate(() => (window.LE_SUPPORT_DEFS || []).filter((d) => /^maps\./.test(d.id)).map((d) => ({ id: d.id, needs: d.needs, memoryMB: d.memoryMB, downloadMB: d.downloadMB })));
  for (const id of ['maps.depth', 'maps.face']) {
    const d = defs.find((x) => x.id === id);
    h.assert(d, id + ' is declared');
    h.assert(d.needs.includes('wasm') && d.needs.includes('wasm-simd') && d.needs.includes('worker'), id + ' needs wasm, simd and a worker');
    h.assert(d.memoryMB >= 300 && d.downloadMB >= 5, id + ' declares memory and download size');
  }
  h.assert.noErrors(page);
};

cases['depth: small model gives a map with real range that matches a near/far split'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/index.html', 'desktop');
  const r = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const d = await LE.maps.depth(img, { maxSide: 266 });
    const at = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = Math.floor(y0 * d.height); y < y1 * d.height; y++) for (let x = Math.floor(x0 * d.width); x < x1 * d.width; x++) { s += d.depth[y * d.width + x]; n++; } return s / n; };
    const sorted = Float32Array.from(d.depth).sort();
    const norm = LE.maps.normals(d, { strength: 1, smooth: 2 });
    const nd = norm.getContext('2d').getImageData(0, 0, norm.width, norm.height).data;
    let nz = 0; for (let i = 0; i < nd.length; i += 4) nz += nd[i + 2];
    const packed = LE.maps.pack.depth(d), back = LE.maps.unpack.depth(packed);
    let maxErr = 0; for (let i = 0; i < d.depth.length; i += 7) maxErr = Math.max(maxErr, Math.abs(back.depth[i] - d.depth[i]));
    return { w: d.width, h: d.height, model: d.model, version: d.version, p5: sorted[Math.floor(sorted.length * 0.05)], p95: sorted[Math.floor(sorted.length * 0.95)],
      near: at(0.65, 0.55, 0.9, 0.85), far: at(0.05, 0.05, 0.3, 0.25), nzMean: nz / (nd.length / 4) / 255, maxErr, loaded: LE.maps.isLoaded('depth'), cached: await LE.maps.isCached('depth-small'), orient: d.orientation };
  }, PHOTO('street-02'));
  h.assert(r.w > 100 && r.h > 100, 'Depth grid has a sensible size: ' + r.w + 'x' + r.h);
  h.assert(r.w % 14 === 0 && r.h % 14 === 0, 'Depth grid follows the 14-pixel model grid');
  h.assert(r.p95 - r.p5 > 0.5, 'Depth has real range (5th to 95th percentile spread ' + (r.p95 - r.p5).toFixed(2) + ')');
  h.assert(r.near - r.far > 0.3, 'The man (near, ' + r.near.toFixed(2) + ') is clearly nearer than the street behind him (far, ' + r.far.toFixed(2) + ')');
  h.assert(r.nzMean > 0.5, 'Normals face the viewer on average (z ' + r.nzMean.toFixed(2) + ')');
  h.assert(r.maxErr < 2e-5, '16-bit depth packing is lossless to 2e-5, got ' + r.maxErr);
  h.assert.equal(r.model, 'depth-small'); h.assert.equal(r.orient, 'near=1');
  h.assert.equal(r.cached, true, 'Model bytes were cached in le-models-v1');
  h.assert.noErrors(page);
};

cases['face: finds a face, landmarks lie inside it, parts are derived'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/index.html', 'desktop');
  const r = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const faces = await LE.maps.face(img, { maxFaces: 8, maxSide: 640, parts: false });
    return faces.map((f) => {
      const b = f.detectorBox, mx = b.w * 0.35, my = b.h * 0.35;
      const inside = f.landmarks.slice(0, 468).filter((p) => p[0] >= b.x - mx && p[0] <= b.x + b.w + mx && p[1] >= b.y - my && p[1] <= b.y + b.h + my).length;
      const L = f.landmarks;
      return { n: f.landmarks.length, inside, score: f.score, eyeAbove: L[159][1] < L[13][1] && L[386][1] < L[13][1], mouthAbove: L[13][1] < L[152][1], box: f.box,
        parts: Object.keys(f.parts), skinRings: f.parts.skin.rings.length, hasBlend: !!f.blendshapes, smile: f.blendshapes ? (f.blendshapes.mouthSmileLeft + f.blendshapes.mouthSmileRight) / 2 : null,
        maskPx: (() => { const c = LE.maps.faceMask(f, 'skin', 320, 213, {}); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) k++; return k; })() };
    });
  }, PHOTO('people-07'));
  h.assert(r.length >= 3, 'At least three of the four people are found, got ' + r.length);
  for (const f of r) {
    h.assert.equal(f.n, 478);
    h.assert(f.inside >= 440, 'Landmarks lie inside the face box (' + f.inside + ' of 468)');
    h.assert(f.score > 0.5, 'Detector score ' + f.score);
    h.assert(f.eyeAbove && f.mouthAbove, 'Eyes above mouth above chin');
    h.assert(['skin', 'eyes', 'lips', 'teeth', 'brows', 'underEyes', 'innerMouth'].every((k) => f.parts.includes(k)), 'All parts present: ' + f.parts.join(','));
    h.assert(f.skinRings >= 5, 'Skin polygon has holes for eyes, brows and lips');
    h.assert(f.maskPx > 200, 'Skin mask has area');
    h.assert(f.hasBlend && f.smile > 0.3, 'Blendshapes say this laughing face is smiling (' + f.smile + ')');
  }
  h.assert.noErrors(page);
};

cases['face: a photo with no face returns none, without errors'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/index.html', 'desktop');
  const n = await page.evaluate(async (src) => { const img = new Image(); img.src = src; await img.decode(); return (await LE.maps.face(img, { maxSide: 640, parts: false })).length; }, PHOTO('garden-02'));
  h.assert.equal(n, 0);
  h.assert.noErrors(page);
};

cases['face: landmarks pack to a few KB and come back'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/index.html', 'desktop');
  const r = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const f = (await LE.maps.face(img, { maxFaces: 1, maxSide: 640, parts: false, blendshapes: false }))[0];
    const p = LE.maps.pack.face(f), u = LE.maps.unpack.face(JSON.parse(JSON.stringify(p)));
    let err = 0; f.landmarks.forEach((q, i) => { err = Math.max(err, Math.abs(q[0] - u.landmarks[i][0]), Math.abs(q[1] - u.landmarks[i][1])); });
    return { bytes: JSON.stringify(p).length, err, parts: Object.keys(u.parts).length };
  }, PHOTO('people-08'));
  h.assert(r.bytes < 6000, 'Packed face is ' + r.bytes + ' bytes');
  h.assert(r.err < 4e-5, 'Packed landmarks match to 4e-5 of the image, got ' + r.err);
  h.assert(r.parts >= 7, 'Parts are re-derived from the packed landmarks');
  h.assert.noErrors(page);
};

cases['depth lab: runs and its three demos draw'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/depth.html', 'desktop');
  await page.selectOption('#pool', 'people-07');
  await page.waitForFunction(() => !document.getElementById('go').disabled);
  await page.selectOption('#side', '266');
  await page.click('#go');
  await page.waitForFunction(() => window.__depthDone || window.__depthError, null, { timeout: 80000 });
  const err = await page.evaluate(() => window.__depthError);
  if (err && /WebGL/.test(err)) return; /* no WebGL2 here: the lab says so; the maps themselves are covered above */
  h.assert(!err, 'Depth lab failed: ' + err);
  await page.waitForTimeout(300);
  const diff = await page.evaluate(() => {
    const photo = document.getElementById('cPhoto'), px = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height).data;
    const out = {};
    ['gBlur', 'gLight', 'gFog'].forEach((id) => {
      const c = document.getElementById(id), t = document.createElement('canvas'); t.width = photo.width; t.height = photo.height; t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      const d = t.getContext('2d').getImageData(0, 0, t.width, t.height).data; let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 40) { s += Math.abs(d[i] - px[i]) + Math.abs(d[i + 1] - px[i + 1]) + Math.abs(d[i + 2] - px[i + 2]); n += 3; }
      out[id] = s / n;
    });
    return out;
  });
  for (const k of Object.keys(diff)) h.assert(diff[k] > 3, k + ' differs from the photo (mean abs diff ' + diff[k].toFixed(1) + ')');
  h.assert.noErrors(page);
};

cases['face lab: overlay, masks and both demos draw'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/labs/maps/face.html', 'desktop');
  await page.selectOption('#pool', 'people-08');
  await page.waitForFunction(() => !document.getElementById('go').disabled);
  await page.uncheck('#useParts');
  await page.click('#go');
  await page.waitForFunction(() => window.__faceDone || window.__faceError, null, { timeout: 80000 });
  h.assert(!(await page.evaluate(() => window.__faceError)), 'Face lab failed: ' + (await page.evaluate(() => window.__faceError)));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const photo = __faceLab.work(), px = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height).data, out = { faces: __faceLab.faces().length };
    ['cOver', 'cSkin', 'cWarp'].forEach((id) => { const c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 40) { s += Math.abs(d[i] - px[i]) + Math.abs(d[i + 1] - px[i + 1]); n += 2; } out[id] = s / n; });
    return out;
  });
  h.assert(r.faces >= 2, 'Two women found');
  h.assert(r.cOver > 0.3, 'Overlay drawn');
  h.assert(r.cSkin > 0.03 && r.cSkin < 15, 'Smoothing changes some pixels, not all (' + r.cSkin.toFixed(2) + ')');
  h.assert(r.cWarp > 0.05, 'Warp changes pixels (' + r.cWarp.toFixed(2) + ')');
  h.assert.noErrors(page);
};

module.exports = cases;
