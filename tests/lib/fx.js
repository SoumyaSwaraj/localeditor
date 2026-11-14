/* Helpers for effect tests (LE.fx). Used by tests/fx.test.js and by the feature teams' effect tests.
 *
 * WebGL2 in the build sandbox: headless Chromium falls back to SwiftShader (ANGLE on a software Vulkan device) with no flags
 * at all, including half-float render targets. GL_ARGS is there for machines where the GPU blocklist gets in the way.
 *
 *   const fx = require('./lib/fx');
 *   const page = await fx.page(browser, base);                       // a blank page with the renderer and every pack loaded
 *   const png = await fx.render(page, { photo: 'arch-01', size: 256, fx: [{ type: 'exposure', p: { ev: 1 } }] });
 *   await fx.golden(page, 'exposure-plus-1', png);                   // compares with tests/golden/fx/exposure-plus-1.png
 *   const d = await fx.diff(page, a, b);                             // { max, mean, over, width, height }
 *
 * Regenerate goldens after an intended pixel change:  FX_GOLDEN=update node tests/run.js fx
 * Goldens are made on the sandbox's software GL; the default tolerance (max 3/255, 0.2 % of pixels over) absorbs driver rounding.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const GOLDEN = path.join(ROOT, 'tests', 'golden', 'fx');
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/* A page with LE.fx loaded and ready. opts.configure is passed to LE.fx.configure (tile, eightBit, budgetMB). */
async function page(browser, base, opts) {
  opts = opts || {};
  const pg = await h.open(browser, base, '/404.html', opts.viewport || 'desktop');
  await pg.addScriptTag({ url: base + '/assets/js/fx/le-fx.js' });
  await pg.evaluate(() => window.LE.fx.ready);
  /* Effect tests render synchronously (LE.fx.apply), also stacks that read statistics: the analysis code, which a document loads per need, is in from the start here. */
  await pg.evaluate(() => window.LE.fx._load('analyze'));
  await pg.addScriptTag({ content: '(' + inPage.toString() + ')()' });
  if (opts.configure) await pg.evaluate((c) => window.LE.fx.configure(c), opts.configure);
  const st = await pg.evaluate(() => window.LE.fx.status());
  if (!st.available) throw new Error('WebGL2 is not available in this browser; launch Chromium with ' + GL_ARGS.join(' '));
  return pg;
}

/* Runs in the page: window.fxT. */
function inPage() {
  const T = window.fxT = {};
  T.load = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not load ' + url)); i.src = url; });
  T.fit = (img, size) => {
    const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height, k = size ? Math.min(1, size / Math.max(w, hh)) : 1;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height); return c;
  };
  /* A deterministic test card: gradients, primaries, fine detail, a transparent corner when alpha is true. */
  T.card = (w, hh, alpha) => {
    const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, w, hh / 4);
    ['#e23b3b', '#3bbf5a', '#3b6fe2', '#e2c53b', '#c23be2', '#3bd3e2'].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * w / 6, hh / 4, w / 6 + 1, hh / 4); });
    const g2 = x.createLinearGradient(0, 0, w, hh); g2.addColorStop(0, '#20324f'); g2.addColorStop(0.5, '#c98d5a'); g2.addColorStop(1, '#f4e9d8'); x.fillStyle = g2; x.fillRect(0, hh / 2, w, hh / 2);
    x.fillStyle = '#111'; for (let i = 0; i < 24; i++) x.fillRect(Math.round(w * 0.1 + i * w * 0.03), Math.round(hh * 0.6), Math.max(1, Math.round(w * 0.01)), Math.round(hh * 0.3));
    x.fillStyle = '#fff'; x.beginPath(); x.arc(w * 0.75, hh * 0.75, Math.min(w, hh) * 0.12, 0, 7); x.fill();
    if (alpha) { x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(w * 0.2, hh * 0.3, Math.min(w, hh) * 0.18, 0, 7); x.fill(); x.globalCompositeOperation = 'source-over'; }
    return c;
  };
  T.png = (canvas) => canvas.toDataURL('image/png');
  T.source = async (o) => {
    if (o.card) return T.card(o.card[0], o.card[1], !!o.alpha);
    return T.fit(await T.load(o.url), o.size);
  };
  T.pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  T.diff = async (a, b, limit) => {
    const ia = await T.load(a), ib = await T.load(b);
    if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return { sizeMismatch: true, a: [ia.naturalWidth, ia.naturalHeight], b: [ib.naturalWidth, ib.naturalHeight], max: 255, mean: 255, over: 1 };
    const da = T.pixels(T.fit(ia)).data, db = T.pixels(T.fit(ib)).data;
    let max = 0, sum = 0, over = 0, at = -1;
    for (let i = 0; i < da.length; i += 4) {
      /* Compare what is seen: colours weighted by their alpha, and the alpha itself. */
      const aa = da[i + 3] / 255, ab = db[i + 3] / 255;
      const d = Math.max(Math.abs(da[i] * aa - db[i] * ab), Math.abs(da[i + 1] * aa - db[i + 1] * ab), Math.abs(da[i + 2] * aa - db[i + 2] * ab), Math.abs(da[i + 3] - db[i + 3]));
      if (d > max) { max = d; at = i / 4; }
      sum += d; if (d > (limit || 3)) over++;
    }
    const n = da.length / 4;
    return { max: Math.round(max * 100) / 100, mean: Math.round(sum / n * 1000) / 1000, over: over / n, width: ia.naturalWidth, height: ia.naturalHeight, at: at < 0 ? null : [at % ia.naturalWidth, Math.floor(at / ia.naturalWidth)] };
  };
}

/* Renders a source through LE.fx.apply and returns a PNG buffer.
   o: { photo: 'arch-01' | card: [w, h] (+ alpha), size, fx, mask, quad, tile, scale, preview, colorSpace, interactive, pad } */
async function render(pg, o) {
  const url = await pg.evaluate(async (opts) => {
    const src = await window.fxT.source({ card: opts.card, alpha: opts.alpha, url: opts.photo ? '/assets/photos/collage/' + opts.photo + '.jpg' : null, size: opts.size });
    const FX = window.LE.fx;
    if (opts.interactive != null) FX.interactive(!!opts.interactive);
    try {
      const out = FX.apply(src, { fx: opts.fx || [], mask: opts.mask || null, quad: opts.quad || null, tile: opts.tile || 0, scale: opts.scale || 1, preview: !!opts.preview, colorSpace: opts.colorSpace, pad: opts.pad || 0, key: opts.key || null });
      return window.fxT.png(out);
    } finally { if (opts.interactive != null) FX.interactive(false); }
  }, o);
  return Buffer.from(url.split(',')[1], 'base64');
}

function dataUrl(buf) { return 'data:image/png;base64,' + buf.toString('base64'); }
function diff(pg, a, b, limit) { return pg.evaluate(([x, y, l]) => window.fxT.diff(x, y, l), [dataUrl(a), dataUrl(b), limit || 3]); }

/* Compares a PNG buffer with tests/golden/fx/<name>.png. tolerance: { max: 3, over: 0.002 }. FX_GOLDEN=update rewrites. */
async function golden(pg, name, png, tolerance) {
  const t = Object.assign({ max: 3, over: 0.002 }, tolerance || {});
  const file = path.join(GOLDEN, name + '.png');
  if (process.env.FX_GOLDEN === 'update' || !fs.existsSync(file)) {
    if (process.env.FX_GOLDEN !== 'update' && process.env.FX_GOLDEN !== 'create') throw new Error('No golden image for "' + name + '". Run FX_GOLDEN=update node tests/run.js fx, look at ' + path.relative(ROOT, file) + ', then commit it.');
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, png);
    return { written: true };
  }
  const d = await diff(pg, fs.readFileSync(file), png, t.max);
  if (d.sizeMismatch) throw new Error('Golden "' + name + '" is ' + d.a.join('×') + ' but the render is ' + d.b.join('×') + '.');
  if (d.over > t.over) {
    const out = path.join(require('os').tmpdir(), 'fx-fail-' + name + '.png');
    fs.writeFileSync(out, png);
    throw new Error('Golden "' + name + '" differs: max ' + d.max + ', mean ' + d.mean + ', ' + (d.over * 100).toFixed(2) + '% of pixels over ' + t.max + ' (worst at ' + d.at + '). Render saved to ' + out);
  }
  return d;
}

/* Asserts two renders agree. Returns the diff. */
async function same(pg, a, b, what, tolerance) {
  const t = Object.assign({ max: 2, over: 0 }, tolerance || {});
  const d = await diff(pg, a, b, t.max);
  if (d.sizeMismatch) throw new Error(what + ': sizes differ, ' + d.a.join('×') + ' and ' + d.b.join('×'));
  if (d.over > t.over) throw new Error(what + ': max difference ' + d.max + ' (mean ' + d.mean + '), ' + (d.over * 100).toFixed(3) + '% of pixels over ' + t.max + ', worst at ' + d.at);
  return d;
}

/* Adds window.fxT (load, fit, card, png, pixels, diff) to any page, e.g. the studio. */
async function attach(pg) { await pg.addScriptTag({ content: '(' + inPage.toString() + ')()' }); return pg; }

/* The studio page's current design exported at a scale, as a PNG buffer. */
async function shot(pg, scale) {
  const url = await pg.evaluate((s) => window.LEStudio.scene.render(s).then((c) => c.toDataURL('image/png')), scale || 1);
  return Buffer.from(url.split(',')[1], 'base64');
}

/* Builds a design that uses every legacy image feature and no expert data, and returns its export at half size.
   kind 'sample': the sample photo with adjust, filter, radius, border, shadow, rotation; a colour-keyed, masked, flipped copy;
   a cut-out with feather and outline; a blended shape; text. kind 'collage': a four-photo grid from the pool. */
async function legacy(pg, kind) {
  await pg.evaluate(async (k) => {
    const c = window.LEStudio, s = c.scene, LE = window.LE;
    if (k === 'collage') {
      const data = await LE.collage.photos(), ids = [];
      for (let i = 0; i < 4; i++) {
        const p = data.photos[i * 3 % data.photos.length];
        const blob = await (await fetch('/' + p.file)).blob();
        ids.push((await c.ingest(new File([blob], p.id + '.jpg', { type: 'image/jpeg' }))).id);
      }
      window.LEStudioCollage.createGrid(c, ids, {});
      const slot = s.layers().find((l) => l.type === 'image');
      s.update(slot.id, { adjust: { contrast: 20, saturation: -40 } });
      return;
    }
    const first = s.layers()[0], src = first.src, filters = Object.keys((LE.presets && LE.presets.filters) || {});
    s.update(first.id, { x: 60, y: 40, w: 900, h: 600, rotation: 4, radius: 40, border: { width: 6, color: '#ffffff' }, shadow: { color: 'rgba(0,0,0,.4)', blur: 24, x: 0, y: 12 },
      adjust: { brightness: 12, contrast: 18, saturation: 25, warmth: 10, highlights: -20, sharpness: 20 }, filter: filters.length ? { name: filters[Math.min(2, filters.length - 1)], intensity: 60 } : null });
    s.add({ type: 'image', src, x: 760, y: 420, w: 380, h: 320, mask: 'ellipse', flipX: true, opacity: 0.9, removeBg: { color: '#ffffff', tolerance: 60 }, crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.7 }, adjust: { blur: 2, hue: 40 } });
    const m = document.createElement('canvas'); m.width = 300; m.height = 200; const mx = m.getContext('2d');
    mx.fillStyle = '#fff'; mx.beginPath(); mx.arc(150, 100, 80, 0, 7); mx.fill();
    s.addAsset('legacy-mask', m);
    s.add({ type: 'image', src, x: 40, y: 480, w: 420, h: 280, cutout: { asset: 'legacy-mask', feather: 4, outline: { width: 8, color: '#ffffff' } }, shadow: { color: 'rgba(0,0,0,.5)', blur: 12, x: 4, y: 6 } });
    s.add({ type: 'shape', shape: 'ellipse', x: 820, y: 60, w: 300, h: 240, fill: { type: 'solid', color: '#7457F0' }, blend: 'multiply', opacity: 0.8 });
    s.add({ type: 'text', text: 'Legacy', x: 120, y: 90, w: 520, h: 120, size: 96, color: '#ffffff', shadow: { color: 'rgba(0,0,0,.6)', blur: 8, x: 0, y: 4 } });
    s.select([]);
  }, kind);
  return shot(pg, 0.5);
}

module.exports = { page, attach, render, shot, legacy, diff, golden, same, dataUrl, inPage, GL_ARGS, GOLDEN, ROOT };
