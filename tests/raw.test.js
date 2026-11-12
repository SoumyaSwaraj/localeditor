'use strict';
/* RAW lab (labs/raw, assets/js/raw, the optional camera module): synthetic DNGs with known truth, measured quality thresholds, no console errors.
 * Every case builds its DNG in the page with tools/dng-synth, so nothing is downloaded and no private photo is needed. */
const cases = {};

const PREP = `
  window.__mk = function (opts) {
    opts = opts || {};
    var S = LEDngSynth, W = opts.W || 256, H = opts.H || 192, sc = S.scene(W, H, opts.kind || 'natural', { sigma: opts.sigma == null ? 0.8 : opts.sigma }), cam = S.cameraFor();
    var mos = S.mosaic(sc, Object.assign({ bits: 14, black: 256, white: 16383, cam: cam, headroom: 0.9 }, opts.mos || {}));
    var bytes = S.writeDNG(Object.assign({ width: W, height: H, mosaic: mos, bits: 14, black: 256, white: 16383, cam: cam, compression: 'lj92', tile: [128, 128] }, opts.dng || {}));
    return { sc: sc, file: new File([bytes], opts.name || 'synthetic.dng', { type: 'image/x-adobe-dng' }), bytes: bytes };
  };
  window.__psnr = function (out, truth, gain) { var se = 0, n = out.length; for (var i = 0; i < n; i++) { var d = Math.min(1, out[i] / gain) - Math.min(1, truth[i]); se += d * d; } return 10 * Math.log10(1 / (se / n)); };
`;

async function lab(h, browser, base) {
  const page = await h.open(browser, base, '/labs/raw/index.html', 'desktop');
  await page.waitForFunction(() => window.LE && LE.raw && window.LEDngSynth && window.LERawDevelop);
  await page.evaluate(PREP);
  return page;
}

cases['support is declared and nothing heavy loads until a RAW file is opened'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  h.assert(!urls.some((u) => /raw-decoder|libraw|\.wasm/.test(u)), 'Camera module fetched before it was needed: ' + urls.join(', '));
  h.assert.equal(await page.evaluate(() => caches.has('le-models-v1')), false, 'Model cache created before the person opened a camera RAW file');
  const ids = await page.evaluate(() => (window.LE_SUPPORT_DEFS || []).map((d) => d.id));
  for (const id of ['raw.dng', 'raw.develop', 'raw.camera', 'hdr.merge']) h.assert(ids.includes(id), 'Missing LE.support definition: ' + id);
  const cam = await page.evaluate(() => LE_SUPPORT_DEFS.find((d) => d.id === 'raw.camera'));
  h.assert(cam.needs.includes('wasm') && cam.needs.includes('worker') && cam.memoryMB >= 500, 'raw.camera needs: ' + JSON.stringify(cam));
  h.assert.noErrors(page);
};

cases['decodes a lossless-JPEG DNG in a Worker: demosaic quality, colour accuracy, embedded preview'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(async () => {
    // a real JPEG preview to embed
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#c84'; x.fillRect(0, 0, 64, 48);
    const jpeg = new Uint8Array(await (await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8))).arrayBuffer());
    const t = __mk({ dng: { preview: jpeg, previewWidth: 64, previewHeight: 48 } });
    const pr = await LE.raw.probe(t.file);
    const t0 = performance.now(); const res = await LE.raw.decode(t.file, { space: 'srgb', format: 'f32' }); const ms = performance.now() - t0;
    // chart colours
    const ch = __mk({ kind: 'chart', W: 480, H: 320, sigma: 0.7, name: 'chart.dng' });
    const cr = await LE.raw.decode(ch.file, { space: 'srgb', format: 'f32' }); const D = LERawDevelop; let sum = 0, mx = 0;
    ch.sc.patches.forEach((p) => { const cx = ((p.x0 + p.x1) / 2) | 0, cy = ((p.y0 + p.y1) / 2) | 0; let a = [0, 0, 0], n = 0; for (let y = cy - 6; y < cy + 6; y++) for (let x = cx - 6; x < cx + 6; x++) { const o = (y * 480 + x) * 3; a[0] += cr.data[o]; a[1] += cr.data[o + 1]; a[2] += cr.data[o + 2]; n++; } a = a.map((v) => v / n / 0.9); const de = D.deltaE76(a, p.rgb); sum += de; if (de > mx) mx = de; });
    return { decoder: pr.decoder, supported: pr.supported, format: pr.format, preview: pr.preview ? { size: pr.preview.blob.size, w: pr.preview.width, h: pr.preview.height } : null, w: res.width, h: res.height, space: res.space, kind: res.meta.decoder, psnr: __psnr(res.data, t.sc.data, 0.9), meanDE: sum / 24, maxDE: mx, ms, temp: res.meta.temp, cfa: res.meta.cfa, compression: res.meta.compression };
  });
  h.assert.equal(r.decoder, 'builtin'); h.assert(r.supported, 'DNG not supported'); h.assert.equal(r.format, 'DNG');
  h.assert(r.preview && r.preview.size > 100, 'No embedded preview extracted: ' + JSON.stringify(r.preview));
  h.assert.equal(r.w, 256); h.assert.equal(r.h, 192); h.assert.equal(r.space, 'srgb');
  h.assert.equal(r.compression, 'lossless-jpeg'); h.assert.equal(r.cfa, 'RGGB');
  h.assert(r.psnr >= 30, 'Demosaic PSNR too low: ' + r.psnr.toFixed(2) + ' dB');
  h.assert(r.meanDE <= 1.0 && r.maxDE <= 2.0, 'Colour chart error: mean dE76 ' + r.meanDE.toFixed(2) + ', max ' + r.maxDE.toFixed(2));
  h.assert(Math.abs(r.temp - 6504) < 60, 'As-shot temperature estimate: ' + r.temp);
  h.assert(r.ms < 30000, 'Decode too slow: ' + r.ms);
  h.assert.noErrors(page);
};

cases['storage variants decode to the same picture (packed 12-bit, big endian 16-bit, strips, other predictors, black pattern, other CFA, deflate, linear DNG)'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const out = await page.evaluate(async () => {
    const variants = {
      'packed 12-bit': { mos: { bits: 12, black: 64, white: 4095 }, dng: { bits: 12, black: 64, white: 4095, compression: 'none', tile: null } },
      'big-endian 16-bit': { mos: { bits: 16, black: 1024, white: 65535 }, dng: { bits: 16, black: 1024, white: 65535, compression: 'none', tile: null, le: false } },
      'lj92 predictor 6, 4 components': { dng: { predictor: 6, components: 4 } },
      'lj92 strips': { dng: { predictor: 7, components: 1, tile: null, rowsPerStrip: 40 } },
      'black level pattern': { mos: { black: [250, 260, 258, 262] }, dng: { black: [250, 260, 258, 262] } },
      'BGGR': { mos: { pattern: 'BGGR' }, dng: { pattern: 'BGGR' } },
      'GRBG, raw in IFD0': { mos: { pattern: 'GRBG' }, dng: { pattern: 'GRBG', layout: 'ifd0' } }
    };
    const res = {};
    for (const k in variants) { const t = __mk(variants[k]); const r = await LE.raw.decode(t.file, { space: 'srgb' }); res[k] = __psnr(r.data, t.sc.data, 0.9); }
    // linear DNG, 16-bit lossless JPEG with 3 components
    const S = LEDngSynth, sc = S.scene(256, 192, 'natural'), cam = S.cameraFor(), M = S.srgbToCamera(cam), mxv = Math.max.apply(null, S.mulv(M, [1, 1, 1])), rgb = new Float32Array(sc.data.length);
    for (let i = 0; i < sc.data.length; i += 3) { const v = S.mulv(M, [sc.data[i], sc.data[i + 1], sc.data[i + 2]]); for (let c = 0; c < 3; c++) rgb[i + c] = Math.min(1, v[c] / mxv * 0.9); }
    const bytes = S.writeDNG({ width: 256, height: 192, linear: { rgb, bits: 16 }, bits: 16, cam, compression: 'lj92', components: 3, tile: null, rowsPerStrip: 64, layout: 'ifd0', white: 65535 });
    const lr = await LE.raw.decode(new File([bytes], 'linear.dng'), { space: 'srgb' }); res['linear DNG (ProRAW-like)'] = __psnr(lr.data, sc.data, 0.9);
    return res;
  });
  for (const k of Object.keys(out)) h.assert(out[k] >= 30, k + ': PSNR ' + out[k].toFixed(2) + ' dB');
  h.assert.noErrors(page);
};

cases['half-size decode, gain-map vignette opcode, default crop and orientation'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(async () => {
    const t = __mk({}); const half = await LE.raw.decode(t.file, { halfSize: true, space: 'srgb' });
    // vignette baked into the scene, undone by the GainMap opcode in OpcodeList2
    const v = __mk({ mos: { vignette: 0.6 }, dng: { opcodes2: [LEDngSynth.vignetteGainMap(256, 192, 0.6)] } });
    const nov = __mk({ mos: { vignette: 0.6 }, dng: {} });
    const rv = await LE.raw.decode(v.file, { space: 'srgb' }), rn = await LE.raw.decode(nov.file, { space: 'srgb' });
    const pv = __psnr(rv.data, v.sc.data, 0.9), pn = __psnr(rn.data, v.sc.data, 0.9);
    const crop = __mk({ dng: { activeArea: [4, 8, 188, 248], cropOrigin: [4, 6], cropSize: [200, 160] } });
    const rc = await LE.raw.decode(crop.file, { space: 'srgb' });
    const ori = __mk({ dng: { orientation: 6 } }); const ro = await LE.raw.decode(ori.file, {});
    return { hw: half.width, hh: half.height, halfPsnrScale: half.meta.timing.developMs, opcodes: rv.meta.opcodes.applied, pv: pv, pn: pn, cw: rc.width, ch: rc.height, orientation: ro.meta.orientation };
  });
  h.assert.equal(r.hw, 128); h.assert.equal(r.hh, 96);
  h.assert(r.opcodes.includes('GainMap'), 'GainMap not applied: ' + JSON.stringify(r.opcodes));
  h.assert(r.pv >= 30 && r.pv > r.pn + 3, 'Gain map did not restore the vignette: PSNR with the opcode ' + r.pv.toFixed(2) + ', without it ' + r.pn.toFixed(2));
  h.assert.equal(r.cw, 200); h.assert.equal(r.ch, 160); h.assert.equal(r.orientation, 6);
  h.assert.noErrors(page);
};

cases['develop controls: white balance, highlight recovery beats clipping, shadow lift, tone curve, look'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(async () => {
    const D = LERawDevelop, C = LERawCore, S = LEDngSynth;
    const t = __mk({ W: 320, H: 240, sigma: 0.9, mos: { exposure: 2.4 } }), dec = await LE.raw.decode(t.file, { space: 'camera' }), cm = LE.raw.matrix ? null : null;
    await LE.raw.ready(); const m = LE.raw.matrix(dec.meta, 'as-shot', 'srgb'), warm = LE.raw.matrix(dec.meta, { temp: 5000, tint: 0 }, 'srgb');
    // highlight methods against the unclipped truth, on pixels where a channel is clipped
    const n = dec.width * dec.height, res = {};
    for (const mode of ['none', 'clip', 'ratio']) {
      const img = D.whiteBalanceAndHighlights({ width: dec.width, height: dec.height, data: dec.data }, m.gains, mode); D.applyMat(img.data, m.wbMatrix);
      let le = 0, cnt = 0; for (let i = 0; i < n; i++) { let cl = false; for (let c = 0; c < 3; c++) if (dec.data[i * 3 + c] >= 0.995) cl = true; if (!cl) continue; const tr = D.luma(t.sc.data[i * 3] * 2.4 * 0.9, t.sc.data[i * 3 + 1] * 2.4 * 0.9, t.sc.data[i * 3 + 2] * 2.4 * 0.9), ex = D.luma(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]); le += Math.abs(Math.log2(Math.max(1e-3, ex) / Math.max(1e-3, tr))); cnt++; }
      res[mode] = le / cnt; res.clipped = cnt;
    }
    // white balance moves the right way: lower assumed temperature = bluer picture
    const white = [1, 1, 1].map(() => 0); const cam = S.mulv(S.srgbToCamera(S.cameraFor()), [1, 1, 1]), mx = Math.max.apply(null, cam), cw = cam.map((v) => v / mx * 0.5);
    const asShotW = C.color.MAT.vec(m.matrix, cw), warmW = C.color.MAT.vec(warm.matrix, cw);
    // tone: shadows lift raises dark pixels and leaves highlights alone
    const dark = { width: 2, height: 1, data: new Float32Array([0.01, 0.01, 0.01, 0.9, 0.9, 0.9]) }; D.toneControls(dark, { shadows: 0.7 });
    // look: monochrome has equal channels, curve is monotonic and ends at 1
    const look = { width: 3, height: 1, data: new Float32Array([0.5, 0.2, 0.1, 0.1, 0.4, 0.2, 2, 2, 2]) }; D.applyLook(look, 'monochrome');
    let mono = true; for (let p = 0; p < 3; p++) if (Math.abs(look.data[p * 3] - look.data[p * 3 + 1]) > 1e-4 || Math.abs(look.data[p * 3 + 1] - look.data[p * 3 + 2]) > 1e-4) mono = false;
    let monotone = true, prev = -1; for (let x = 0; x <= 4; x += 0.05) { const y = D.baseCurve(x, 0.55); if (y < prev - 1e-9) monotone = false; prev = y; }
    return { hl: res, asShotW, warmW, darkGain: dark.data[0] / 0.01, brightGain: dark.data[3] / 0.9, mono, monotone, endsAtOne: D.baseCurve(50, 0.55) };
  });
  h.assert(r.hl.clipped > 500, 'Test scene did not clip: ' + r.hl.clipped);
  h.assert(r.hl.ratio < r.hl.clip - 0.05, 'Colour propagation (' + r.hl.ratio.toFixed(3) + ' EV) should beat clip-to-white (' + r.hl.clip.toFixed(3) + ' EV) on luminance of clipped pixels');
  h.assert(r.hl.ratio < r.hl.none, 'Colour propagation should beat leaving channels clipped');
  h.assert(Math.abs(r.asShotW[0] - r.asShotW[2]) < 0.02, 'As-shot white balance should make white neutral: ' + JSON.stringify(r.asShotW));
  h.assert(r.warmW[2] > r.warmW[0] * 1.3, 'Assuming 5000 K should make a daylight white bluer: ' + JSON.stringify(r.warmW));
  h.assert(r.darkGain > 2.5 && Math.abs(r.brightGain - 1) < 0.02, 'Shadow lift: dark x' + r.darkGain.toFixed(2) + ', bright x' + r.brightGain.toFixed(2));
  h.assert(r.mono && r.monotone && Math.abs(r.endsAtOne - 1) < 0.01, 'Look/curve sanity: ' + JSON.stringify({ mono: r.mono, monotone: r.monotone, end: r.endsAtOne }));
  h.assert.noErrors(page);
};

cases['denoise and lateral CA correction measurably help on synthetic data'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(() => {
    const S = LEDngSynth, D = LERawDevelop, w = 128, h = 96, sc = S.scene(w, h, 'natural', { sigma: 1.0 }), clean = new Float32Array(sc.data), rnd = S.mulberry32(5), noisy = new Float32Array(clean.length);
    const Sg = 1.5e-3, Og = Sg * Sg * 0.5;
    for (let i = 0; i < clean.length; i++) { const v = Math.max(0, clean[i] * 0.5); noisy[i] = Math.max(0, v + Math.sqrt(Sg * v + Og) * S.gauss(rnd)); }
    const ref = clean.map((v) => v * 0.5), den = { width: w, height: h, data: new Float32Array(noisy) }; D.denoiseWavelet(den, { S: Sg, O: Og }, 0.5);
    const bil = { width: w, height: h, data: new Float32Array(noisy) }; D.denoiseBilateral(bil, 2, 0.02);
    const base = D.psnr(noisy, ref, ref.length, 0.5), wav = D.psnr(den.data, ref, ref.length, 0.5), bi = D.psnr(bil.data, ref, ref.length, 0.5);
    const big = S.scene(320, 240, 'natural', { sigma: 0.7 }), src = { width: 320, height: 240, data: big.data }, bad = D.lateralCA(src, 0.004, -0.004);
    const est = D.estimateCA(bad, 0.006, 9), fixed = D.lateralCA(bad, est.kR, est.kB);
    return { base, wav, bi, e0: [D.edgeCorr(bad, 0), D.edgeCorr(bad, 2)], e1: [D.edgeCorr(fixed, 0), D.edgeCorr(fixed, 2)], clean: [D.edgeCorr(src, 0), D.edgeCorr(src, 2)], est };
  });
  h.assert(r.wav > r.base + 1.0 && r.bi > r.base + 1.0, 'Denoise PSNR: noisy ' + r.base.toFixed(2) + ', wavelet ' + r.wav.toFixed(2) + ', bilateral ' + r.bi.toFixed(2));
  h.assert(r.e1[0] > r.e0[0] && r.e1[1] > r.e0[1], 'CA correction should raise edge correlation: before ' + r.e0.map((v) => v.toFixed(4)) + ' after ' + r.e1.map((v) => v.toFixed(4)));
  h.assert(Math.abs(r.est.kR + 0.004) < 0.0015 && Math.abs(r.est.kB - 0.004) < 0.0015, 'CA estimate: ' + JSON.stringify(r.est));
  h.assert.noErrors(page);
};

cases['rejects non-RAW and damaged files with a plain reason, no console errors'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16; const jpg = new File([await (await new Promise((res) => c.toBlob(res, 'image/jpeg'))).arrayBuffer()], 'photo.jpg');
    const pj = await LE.raw.probe(jpg);
    const t = __mk({}); const cut = new File([t.bytes.slice(0, Math.floor(t.bytes.length * 0.5))], 'cut.dng');
    let err = null; try { await LE.raw.decode(cut, {}); } catch (e) { err = e.message; }
    const unknown = await LE.raw.probe(new File([new Uint8Array(500)], 'x.bin'));
    // a DNG with an X-Trans-like 6x6 pattern must say the camera module is needed rather than fail
    const bytes = t.bytes.slice(); // copy; patch CFARepeatPatternDim 2x2 -> 6x6 is not needed: probe a fake NEF header instead
    const fake = new Uint8Array(2000); fake.set([0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]); const pn = await LE.raw.probe(new File([fake], 'DSC_0001.NEF'));
    return { jpg: pj, err, unknown: unknown, nef: { decoder: pn.decoder, format: pn.format, supported: pn.supported, needsDownload: pn.needsDownload, module: pn.module } };
  });
  h.assert(!r.jpg.supported && /ordinary picture/.test(r.jpg.why), 'JPEG probe: ' + JSON.stringify(r.jpg.why));
  h.assert(r.err, 'A truncated DNG should fail to decode'); h.assert(!r.unknown.supported && /not a recognised/.test(r.unknown.why), 'Unknown file: ' + r.unknown.why);
  h.assert.equal(r.nef.decoder, 'camera'); h.assert.equal(r.nef.format, 'NEF'); h.assert(r.nef.needsDownload === true, 'NEF should need the module download');
  h.assert(r.nef.module && r.nef.module.licence === 'LGPL-2.1' && /licenses/.test(r.nef.module.licenceUrl), 'Licence info missing from probe: ' + JSON.stringify(r.nef.module));
  h.assert.noErrors(page, [/Failed to load resource/]);
};

cases['camera module: downloaded on demand, cached with its id, licence line shown once, decodes, replaceable interface'] = async ({ browser, base, h }) => {
  const page = await lab(h, browser, base);
  // observe network requests for the module
  const reqs = []; page.on('request', (rq) => { if (/raw-decoder/.test(rq.url())) reqs.push(rq.url().split('/').pop()); });
  const asked = [];
  await page.evaluate(() => { window.LE.downloads = { request: (o) => { (window.__asked = window.__asked || []).push(o); return Promise.resolve({ ok: true }); }, track: () => ({ progress() { }, done() { }, fail() { } }) }; });
  const r = await page.evaluate(async () => {
    const t = __mk({ W: 192, H: 128 }); const before = await LE.raw.camera.isCached();
    const res = await LE.raw.decode(t.file, { decoder: 'camera', space: 'camera', format: 'f32' });
    const cached = await LE.raw.camera.isCached(), c = await caches.open('le-models-v1'), keys = await c.keys(), entry = await c.match(keys[0]);
    const note = document.querySelector('.le-raw-licence'), noteText = note ? note.textContent : null, links = note ? Array.prototype.map.call(note.querySelectorAll('a'), (a) => a.getAttribute('href')) : [];
    const second = await LE.raw.decode(t.file, { decoder: 'camera', format: 'f32', halfSize: true });
    const notes2 = document.querySelectorAll('.le-raw-licence').length;
    const mean = (d) => { let s = 0; for (let i = 0; i < d.length; i += 31) s += d[i]; return s / (d.length / 31); };
    return { before, cached, entryId: entry && entry.headers.get('x-le-model'), entryType: entry && entry.headers.get('content-type'), noteText, links, w: res.width, h: res.height, kind: res.meta.decoder, mod: res.meta.module, space: res.space, mean: mean(res.data), halfW: second.width, notes2, asked: window.__asked, hasMatrix: !!res.meta.matrix, model: res.meta.model };
  });
  h.assert.equal(r.before, false); h.assert.equal(r.cached, true, 'Module was not cached');
  h.assert.equal(r.entryId, 'raw-camera', 'Cache entry must carry x-le-model: raw-camera for the storage manager');
  h.assert(r.noteText && /LibRaw/.test(r.noteText) && /LGPL/.test(r.noteText), 'Licence line missing or incomplete: ' + r.noteText);
  h.assert(r.links.some((l) => /licenses/.test(l)) && r.links.some((l) => /LibRaw/.test(l)), 'Licence line links: ' + JSON.stringify(r.links));
  h.assert.equal(r.notes2, 1, 'The licence line must appear once, not on every open');
  h.assert.equal(r.kind, 'camera'); h.assert.equal(r.mod.licence, 'LGPL-2.1'); h.assert.equal(r.w, 192); h.assert.equal(r.h, 128); h.assert.equal(r.halfW, 96);
  h.assert(r.mean > 0.02 && r.mean < 0.9, 'Decoded picture looks empty or blown out: mean ' + r.mean);
  h.assert(r.asked && r.asked[0].id === 'raw.camera' && r.asked[0].kind === 'feature', 'LE.downloads.request not called with the contract: ' + JSON.stringify(r.asked));
  h.assert(r.hasMatrix, 'meta.matrix missing');
  h.assert(reqs.filter((x) => x === 'raw-decoder.wasm').length === 1, 'The wasm file should be requested exactly once: ' + reqs.join(','));
  h.assert.noErrors(page);
};

cases['the Open-source licences page lists the RAW decoder in its own section with the written source offer'] = async ({ browser, base, h }) => {
  for (const vp of ['desktop', 'phone']) {
    const page = await h.open(browser, base, '/licenses/index.html', vp);
    const r = await page.evaluate(() => {
      const s = document.getElementById('libraw'); const t = s ? s.textContent : '';
      return { has: !!s, lgpl: /LGPL/.test(t), offer: /written offer/i.test(t), source: !!s && !!s.querySelector('a[href*="LibRaw/LibRaw"]'), text: !!s && !!s.querySelector('a[href*="libraw-LICENSE.LGPL.txt"]'), rows: document.querySelectorAll('table tbody tr').length, h1: (document.querySelector('h1') || {}).textContent, exception: /exception/i.test(t) };
    });
    h.assert(r.has && r.lgpl && r.offer && r.source && r.text && r.exception, vp + ': RAW section incomplete ' + JSON.stringify(r));
    h.assert(r.rows > 40, 'Expected every third-party row, got ' + r.rows);
    await h.noOverflow(page);
    h.assert.noErrors(page);
  }
  for (const f of ['libraw-LICENSE.LGPL.txt', 'libraw-LICENSE.CDDL.txt', 'libraw-COPYRIGHT.txt', 'emscripten-runtime-LICENSES.txt']) {
    const res = await (await fetch(base + '/assets/vendor/licenses/' + f)).text(); h.assert(res.length > 500, f + ' missing');
  }
};

module.exports = cases;
