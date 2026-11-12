#!/usr/bin/env node
/* Effect renderer timings (LE.fx). Prints milliseconds per pass for every registered effect, a typical stack in preview,
 * draft and export, and a main-thread-against-worker comparison.
 *
 *   node tools/fx-bench/run.js                 every effect at 1 MP and 2 MP, the typical stack, a 6 MP tiled export
 *   node tools/fx-bench/run.js --export=24     also a 24 MP export (minutes on software GL)
 *   node tools/fx-bench/run.js --only=blur     effects whose id contains "blur"
 *   node tools/fx-bench/run.js --json          machine-readable
 *   node tools/fx-bench/run.js --worker        add the OffscreenCanvas-in-a-worker comparison
 *   node tools/fx-bench/run.js --headed        a visible browser (use this on a machine with a real GPU)
 *
 * Each pass is followed by a one-pixel read-back, so a pass's time is the time to really draw it; that makes totals a little
 * higher than an unprofiled render. The build sandbox has no GPU (SwiftShader): its numbers are for comparing passes and catching regressions,
 * not for judging the budgets in docs/EXPERT-MODE.md. Run it with --headed on real hardware for those. */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const h = require(path.join(ROOT, 'tests', 'lib', 'harness'));
const fx = require(path.join(ROOT, 'tests', 'lib', 'fx'));

const arg = (name, def) => { const a = process.argv.find((x) => x.indexOf('--' + name) === 0); return a ? (a.indexOf('=') >= 0 ? a.split('=')[1] : true) : def; };
const JSON_OUT = !!arg('json', false), ONLY = arg('only', ''), EXPORT_MP = Number(arg('export', 6)), WORKER = !!arg('worker', false), HEADED = !!arg('headed', false);
const TYPICAL = [
  { type: 'white-balance', p: { temperature: 12, tint: -3 } }, { type: 'exposure', p: { ev: 0.3 } }, { type: 'contrast', p: { amount: 15 } },
  { type: 'highlights-shadows', p: { highlights: -40, shadows: 30 } }, { type: 'curves', p: { master: [[0, 0], [0.25, 0.22], [0.75, 0.8], [1, 1]] } },
  { type: 'saturation', p: { vibrance: 20 } }, { type: 'gaussian-blur', p: { radius: 6 }, mask: { parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.35, ry: 0.35, feather: 0.5, invert: true }] } },
  { type: 'grain', p: { amount: 20 } }
];

function inPage() {
  const FX = window.LE.fx, B = window.fxB = {};
  /* A photo-like source: a pool photo scaled to the wanted megapixels (so there is real detail to blur and grade). */
  B.source = async (mp) => {
    const img = await window.fxT.load('/assets/photos/collage/arch-02.jpg');
    const ar = img.naturalWidth / img.naturalHeight, hgt = Math.round(Math.sqrt(mp * 1e6 / ar)), w = Math.round(hgt * ar);
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, hgt);
    return c;
  };
  B.sources = {};
  B.get = async (mp) => B.sources[mp] || (B.sources[mp] = await B.source(mp));
  B.time = async (mp, stack, opts) => {
    const src = await B.get(mp), o = Object.assign({ fx: stack, scale: 1 }, opts || {});
    FX.apply(src, o);                                   /* warm-up: compiles shaders, fills pools */
    if (o.preview) { FX.trim(true); }                   /* preview timings are for a cold stage cache unless asked */
    const runs = [];
    for (let i = 0; i < (opts && opts.runs || 3); i++) {
      if (o.cold !== false) FX.trim(false);
      FX.profile(true);
      const t0 = performance.now();
      const out = FX.apply(src, o);
      const wall = performance.now() - t0, passes = FX.profile(false);
      runs.push({ wall, passes, w: out.width, h: out.height });
    }
    runs.sort((a, b) => a.wall - b.wall);
    const best = runs[0], by = {};
    best.passes.forEach((p) => { const k = p.label.replace(/^color\(.*\)/, 'color'); by[k] = by[k] || { ms: 0, n: 0 }; by[k].ms += p.ms; by[k].n++; });
    return { mp: (src.width * src.height) / 1e6, size: [src.width, src.height], wall: best.wall, gpu: best.passes.reduce((s, p) => s + p.ms, 0), passes: best.passes.length, by, list: best.passes.map((p) => [p.label, Math.round(p.ms * 10) / 10, p.w + 'x' + p.h]) };
  };
  B.main = async (mp, stack, n) => {
    const src = await B.get(mp); let blocked = 0; const t0 = performance.now();
    for (let i = 0; i < n; i++) { const a = performance.now(); FX.apply(src, { fx: stack }); blocked += performance.now() - a; await new Promise((r) => setTimeout(r, 0)); }
    return { latency: (performance.now() - t0) / n, blocked: blocked / n };
  };
  B.worker = async (mp, stack, n, url) => {
    const src = await B.get(mp), w = new Worker(url);
    const call = (msg, transfer) => new Promise((res, rej) => { w.onmessage = (e) => (e.data.error ? rej(new Error(e.data.error)) : res(e.data)); w.postMessage(msg, transfer || []); });
    await call({ init: location.origin + '/assets/js/fx/le-fx.js' });
    const out = document.createElement('canvas'); out.width = src.width; out.height = src.height; const octx = out.getContext('2d');
    const once = async () => {
      let blocked = 0, a = performance.now();
      const bmpP = createImageBitmap(src); blocked += performance.now() - a;
      const bmp = await bmpP;
      a = performance.now(); const p = call({ bitmap: bmp, fx: stack }, [bmp]); blocked += performance.now() - a;
      const res = await p;
      a = performance.now(); octx.drawImage(res.bitmap, 0, 0); res.bitmap.close(); blocked += performance.now() - a;
      return { blocked, inWorker: res.ms };
    };
    await once();
    let blocked = 0, inWorker = 0; const t0 = performance.now();
    for (let i = 0; i < n; i++) { const r = await once(); blocked += r.blocked; inWorker += r.inWorker; }
    w.terminate();
    return { latency: (performance.now() - t0) / n, blocked: blocked / n, inWorker: inWorker / n };
  };
}

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch({ headless: !HEADED, args: HEADED ? [] : [] });
  const out = { when: new Date().toISOString(), effects: [], typical: {}, exports: [] };
  try {
    const page = await fx.page(browser, base);
    await page.addScriptTag({ content: '(' + inPage.toString() + ')()' });
    out.status = await page.evaluate(() => { const s = window.LE.fx.status(); return { renderer: s.renderer, float: s.float, maxTexture: s.maxTexture, budgetMB: Math.round(s.memory.budget / 1048576) }; });
    const list = await page.evaluate(() => window.LE.fx.describe().effects.map((e) => ({ id: e.id, example: e.agent.example, spatial: e.spatial })));
    for (const e of list) {
      if (ONLY && e.id.indexOf(ONLY) < 0) continue;
      const entry = { type: e.id, p: (e.example && e.example.p) || {} };
      const a = await page.evaluate(([en]) => window.fxB.time(1, [en]), [entry]);
      const b = await page.evaluate(([en]) => window.fxB.time(2, [en]), [entry]);
      out.effects.push({ id: e.id, spatial: e.spatial, passes: b.passes, ms1: a.gpu, ms2: b.gpu, wall2: b.wall, by: b.by });
    }
    if (!ONLY) {
      out.typical.full = await page.evaluate(([s]) => window.fxB.time(2, s), [TYPICAL]);
      out.typical.colourOnly = await page.evaluate(([s]) => window.fxB.time(2, s), [TYPICAL.slice(0, 6)]);
      out.typical.draft = await page.evaluate(async ([s]) => { window.LE.fx.interactive(true); try { return await window.fxB.time(2, s, { preview: true, key: 'bench' }); } finally { window.LE.fx.interactive(false); } }, [TYPICAL]);
      out.typical.cachedColour = await page.evaluate(async ([s]) => {
        const FX = window.LE.fx, src = await window.fxB.get(2), tail = s.slice(0, 7).concat([{ type: 'exposure', p: { ev: 0.1 } }]);
        FX.apply(src, { fx: tail, preview: true, key: 'bench2' });
        tail[7] = { type: 'exposure', p: { ev: 0.2 } };
        FX.profile(true); const t0 = performance.now(); FX.apply(src, { fx: tail, preview: true, key: 'bench2' });
        const wall = performance.now() - t0, passes = FX.profile(false);
        return { wall, gpu: passes.reduce((a, p) => a + p.ms, 0), passes: passes.length, list: passes.map((p) => [p.label, Math.round(p.ms * 10) / 10]) };
      }, [TYPICAL]);
      for (const mp of [6].concat(EXPORT_MP > 6 ? [EXPORT_MP] : [])) {
        const t = await page.evaluate(async ([s, m]) => { const FX = window.LE.fx, t0 = FX.status().stats.tiles; const r = await window.fxB.time(m, s, { runs: 1 }); r.tiles = (FX.status().stats.tiles - t0) / 2; r.mem = FX.status().memory; delete r.list; return r; }, [TYPICAL, mp]);
        out.exports.push(t);
      }
      if (WORKER) {
        out.worker = {
          main: await page.evaluate(([s]) => window.fxB.main(2, s, 4), [TYPICAL]),
          worker: await page.evaluate(([s, u]) => window.fxB.worker(2, s, 4, u), [TYPICAL, base + '/tools/fx-bench/worker.js']).catch((e) => ({ error: String(e.message).split('\n')[0] }))
        };
      }
    }
  } finally { await browser.close(); server.close(); }

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 1)); return; }
  const f = (v) => (v == null ? '-' : v.toFixed(1)).padStart(8);
  console.log('LE.fx bench on ' + out.status.renderer + (out.status.float ? ' (half-float)' : ' (8-bit)') + ', max texture ' + out.status.maxTexture + ', budget ' + out.status.budgetMB + ' MB');
  console.log('\nEffect                 passes   ms @1MP  ms @2MP    ms/MP   passes at 2 MP');
  out.effects.forEach((e) => console.log(e.id.padEnd(22) + String(e.passes).padStart(6) + f(e.ms1) + f(e.ms2) + f(e.ms2 / 2) + '   ' + Object.keys(e.by).map((k) => k + ' ' + e.by[k].ms.toFixed(1) + (e.by[k].n > 1 ? ' (' + e.by[k].n + ')' : '')).join(', ')));
  if (out.typical.full) {
    const t = out.typical;
    console.log('\nTypical stack at 2 MP (white balance, exposure, contrast, tone regions, curves, vibrance, masked blur, grain):');
    console.log('  six colour effects, one merged pass:  ' + f(t.colourOnly.gpu) + ' ms  (' + t.colourOnly.passes + ' pass' + (t.colourOnly.passes > 1 ? 'es' : '') + ', wall ' + t.colourOnly.wall.toFixed(1) + ')');
    console.log('  full stack, full quality:             ' + f(t.full.gpu) + ' ms  (' + t.full.passes + ' passes, wall ' + t.full.wall.toFixed(1) + ')');
    console.log('  full stack, draft while dragging:     ' + f(t.draft.gpu) + ' ms  (' + t.draft.passes + ' passes, wall ' + t.draft.wall.toFixed(1) + ')');
    console.log('  colour change after a cached blur:    ' + f(t.cachedColour.gpu) + ' ms  (' + t.cachedColour.passes + ' pass' + (t.cachedColour.passes > 1 ? 'es' : '') + ', wall ' + t.cachedColour.wall.toFixed(1) + ')');
    console.log('  passes: ' + t.full.list.map((p) => p[0] + ' ' + p[1]).join(' | '));
    out.exports.forEach((e) => console.log('\nTiled export, ' + e.mp.toFixed(1) + ' MP (' + e.size.join('×') + '): ' + (e.wall / 1000).toFixed(2) + ' s in ' + e.tiles + ' tiles, ' + e.passes + ' passes, GPU memory after ' + Math.round(e.mem.bytes / 1048576) + ' of ' + Math.round(e.mem.budget / 1048576) + ' MB'));
    if (out.worker) {
      const w = out.worker;
      console.log('\nMain thread against OffscreenCanvas in a worker (typical stack, 2 MP, per render):');
      console.log('  main thread:  latency ' + w.main.latency.toFixed(1) + ' ms, main thread blocked ' + w.main.blocked.toFixed(1) + ' ms');
      console.log(w.worker.error ? '  worker:       failed: ' + w.worker.error : '  worker:       latency ' + w.worker.latency.toFixed(1) + ' ms, main thread blocked ' + w.worker.blocked.toFixed(1) + ' ms, in the worker ' + w.worker.inWorker.toFixed(1) + ' ms');
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
