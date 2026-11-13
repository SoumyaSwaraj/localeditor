'use strict';
/* Open design format (.ledesign.json): examples, shorthand, rejects, remote images, round trips, side maps,
   variables, lint and the studio File menu flows. Asserts on documents, not pixels, except where noted. */
const fs = require('fs');
const path = require('path');

const EX_DIR = path.join(__dirname, '..', 'examples', 'designs');
const examples = () => fs.readdirSync(EX_DIR).filter((f) => f.endsWith('.ledesign.json')).sort().map((f) => [f, fs.readFileSync(path.join(EX_DIR, f), 'utf8')]);
const cases = {};

async function studio(browser, base, h, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.design);
  await h.need(page, 'design');
  return page;
}
const D = (layers, extra) => JSON.stringify(Object.assign({ format: 'localeditor-design', version: 1, name: 'T', pages: [{ width: 1080, height: 1080, layers: layers }] }, extra || {}));
/* A real 4 × 2 PNG made by the browser, as a data: URI. */
const tinyPng = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 4; c.height = 2; const x = c.getContext('2d'); x.fillStyle = '#c0392b'; x.fillRect(0, 0, 4, 2); return c.toDataURL('image/png'); });

cases['every example parses cleanly, renders, and round-trips byte-stable'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const list = examples();
  h.assert(list.length >= 10, 'Expected 10 example designs, found ' + list.length);
  const r = await page.evaluate(async (list) => {
    const out = [];
    for (const [name, text] of list) {
      const a = await LE.design.parse(text);
      if (!a.ok) { out.push({ name, errors: a.errors }); continue; }
      const t1 = LE.design.stringify(a.project).text;
      const b = await LE.design.parse(t1);
      const t2 = b.ok ? LE.design.stringify(b.project).text : '';
      const bad = a.warnings.filter((w) => w.kind !== 'unknown-key');
      const pg = a.project.pages[0];
      const cv = await window.LEStudio.hiddenRender(pg, 200 / Math.max(pg.width, pg.height));
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      for (let i = 0; i < px.length; i += 64) seen.add(px[i] >> 4 << 8 | px[i + 1] >> 4 << 4 | px[i + 2] >> 4);
      out.push({ name, errors: [], warnings: bad.map((w) => w.kind + ' ' + w.path), stable: t1 === t2, colors: seen.size, pages: a.project.pages.length });
    }
    return out;
  }, list);
  r.forEach((x) => {
    h.assert(!x.errors.length, x.name + ': ' + JSON.stringify(x.errors[0]));
    h.assert(!x.warnings.length, x.name + ' has lint warnings: ' + x.warnings.join(', '));
    h.assert(x.stable, x.name + ' is not byte-stable across parse → stringify → parse → stringify');
    h.assert(x.colors >= 3, x.name + ' rendered almost blank');
  });
  h.assert(r.some((x) => x.pages > 1), 'One example must have several pages');
  h.assert.noErrors(page);
};

cases['shorthand normalises to the long form'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const TINY_PNG = await tinyPng(page);
  const r = await page.evaluate(async ([png]) => {
    const text = JSON.stringify({ format: 'localeditor-design', version: 1, name: 'Shorthand', pages: [
      { width: 1000, height: 800, background: '#123456', layers: [
        { id: 'a', type: 'shape', shape: 'rectangle', fill: '#E0B354', x: 'center', y: 'bottom', w: '50%', h: '25%' },
        { id: 't', type: 'text', text: 'One line', font: 'Inter', size: 50, lineHeight: 1.2, x: '10%', y: 'center', w: 800 },
        { id: 't2', type: 'text', text: 'Line one\nLine two\nLine three', font: 'Inter', size: 40, w: 600, h: 'auto' },
        { id: 's', type: 'text', text: 'A long headline that must shrink to fit its box', font: 'Inter', size: 300, w: 400, h: 200, fit: 'shrink' },
        { id: 'i', type: 'icon', icon: 'lucide:sun', color: '#ffffff', x: 10, y: 10, w: 64 },
        { id: 'slot', type: 'image', slot: true, name: 'Hero', x: 0, y: 0, w: 300, h: 200 },
        { id: 'look', type: 'image', slot: true, recipe: 'golden-hour', x: 0, y: 0, w: 300, h: 200 },
        { id: 'pic', type: 'image', src: png, x: 0, y: 0, w: 200, h: 200 },
        { id: 'rel', type: 'image', src: 'assets/pic.png', x: 0, y: 0, w: 100, h: 100, fit: 'stretch' }
      ] },
      { width: 1000, height: 1000, background: { type: 'image', src: png, fit: 'stretch' }, layers: [] },
      { width: 1000, height: 1000, background: { type: 'image', src: png, fit: 'fill' }, layers: [] },
      { width: 1080, height: 1350, collage: { layout: 'r-2.3' }, layers: [] }
    ] });
    const res = await LE.design.parse(text, { resolve: (p) => (p === 'assets/pic.png' ? fetch(png).then((x) => x.blob()) : null) });
    if (!res.ok) return { errors: res.errors };
    const L = (pi, id) => res.project.pages[pi].layers.find((l) => l.id === id);
    const m1 = LE.design.measureText(L(0, 't2'));
    const ms = LE.design.measureText(L(0, 's'));
    return {
      ok: res.ok, a: L(0, 'a'), t: L(0, 't'), t2: L(0, 't2'), m1, s: L(0, 's'), ms, icon: L(0, 'i'), slot: L(0, 'slot'), look: L(0, 'look'), pic: L(0, 'pic'), rel: L(0, 'rel'),
      assets: Object.keys(res.project.assets).length, blobs: Object.keys(res.assets).length,
      bg0: res.project.pages[0].background, bg1: res.project.pages[1].background, bg2: res.project.pages[2].background,
      collage: res.project.pages[3].collage, cells: res.project.pages[3].layers.filter((l) => l.slot).map((l) => [l.x, l.y, l.w, l.h])
    };
  }, [TINY_PNG]);
  h.assert(r.ok, 'parse failed: ' + JSON.stringify(r.errors));
  h.assert.equal(r.a.x, 250, 'x: "center"'); h.assert.equal(r.a.w, 500, 'w: "50%"'); h.assert.equal(r.a.h, 200, 'h: "25%"'); h.assert.equal(r.a.y, 600, 'y: "bottom"');
  h.assert.equal(JSON.stringify(r.a.fill), JSON.stringify({ type: 'solid', color: '#E0B354' }), 'string fill');
  h.assert.equal(r.t.x, 100, 'x: "10%"');
  h.assert.equal(r.t.h, 60, 'one-line text height is size × lineHeight');
  h.assert.equal(r.t.y, 370, 'y: "center" uses the measured height');
  h.assert.equal(r.t2.h, Math.ceil(r.m1.height), 'h: "auto" measures');
  h.assert.equal(r.t2.h, 144, 'three lines at 40 × 1.2');
  h.assert(r.s.size < 300 && r.s.size > 20, 'fit: shrink lowers the size, got ' + r.s.size);
  h.assert(r.ms.height <= 200.5 && !r.ms.broke, 'shrunk text fits its box');
  h.assert.equal(r.icon.type, 'svg'); h.assert.equal(r.icon.assetId, 'lucide:sun'); h.assert(/<svg/.test(r.icon.svg), 'icon markup generated'); h.assert.equal(r.icon.h, 64, 'icon is square when one side is given');
  h.assert.equal(JSON.stringify(r.slot.slot), JSON.stringify({ id: 'slot', label: 'Hero', photo: '' }), 'slot: true');
  h.assert.equal(r.slot.src, '', 'empty slot has no photo');
  h.assert(r.look.adjust.recipe && r.look.adjust.recipe.id === 'golden-hour', 'recipe recorded on the layer');
  h.assert(typeof r.look.adjust.warmth === 'number' && r.look.adjust.warmth > 0, 'recipe adds its look');
  h.assert(/^[a-f0-9]{64}$/.test(r.pic.src), 'data: URI becomes a stored asset');
  h.assert(r.pic.crop.w < 1 || r.pic.crop.h < 1 || (r.pic.crop.w === 1 && r.pic.crop.h === 1), 'cover crop computed');
  h.assert.equal(r.pic.crop.w, 0.5, '4×2 image in a square frame is cover-cropped');
  h.assert.equal(r.rel.src, r.pic.src, 'relative path resolved through opts.resolve (same bytes, same id)');
  h.assert.equal(r.rel.crop.w, 1, 'fit: stretch keeps the full image');
  h.assert.equal(r.assets, 1); h.assert.equal(r.blobs, 1);
  h.assert.equal(JSON.stringify(r.bg0), JSON.stringify({ type: 'color', color: '#123456' }), 'string background');
  h.assert.equal(r.bg1.fit, 'fill', 'friendly "stretch" is stored as legacy "fill"');
  h.assert.equal(r.bg2.fit, 'cover', 'friendly "fill" is stored as legacy "cover"');
  h.assert.equal(r.collage.layout, 'r-2.3'); h.assert.equal(r.collage.cells.length, 5); h.assert.equal(r.cells.length, 5, 'layout id creates the slots');
  h.assert(r.cells.every((c) => c[2] > 100 && c[3] > 100), 'cells laid out');
  h.assert.noErrors(page);
};

cases['unsafe or broken files are rejected with JSON-pointer paths'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const D = (layers, extra) => JSON.stringify(Object.assign({ format: 'localeditor-design', version: 1, name: 'T', pages: [{ width: 1080, height: 1080, layers: layers }] }, extra || {}));
    const tries = {
      script: D([{ id: 't', type: 'text', text: '<script>alert(1)</script>', x: 0, y: 0, w: 100 }]),
      html: D([{ id: 't', type: 'text', text: 'hi', name: '<img src=x onerror=alert(1)>', x: 0, y: 0, w: 100 }]),
      unknownType: D([{ id: 'x', type: 'video', x: 0, y: 0, w: 1, h: 1 }]),
      proto: '{"format":"localeditor-design","version":1,"pages":[{"layers":[{"id":"a","type":"shape","w":1,"h":1,"__proto__":{"polluted":1}}]}]}',
      ctor: D([{ id: 'a', type: 'shape', w: 1, h: 1, params: { constructor: 1 } }]),
      jsUrl: D([{ id: 'p', type: 'image', src: 'javascript:alert(1)', w: 10, h: 10 }]),
      svgScript: D([{ id: 's', type: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', w: 10, h: 10 }]),
      svgOn: D([{ id: 's', type: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>', w: 10, h: 10 }]),
      svgData: D([{ id: 'p', type: 'image', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', w: 10, h: 10 }]),
      dup: D([{ id: 'a', type: 'shape', w: 1, h: 1 }, { id: 'a', type: 'shape', w: 1, h: 1 }]),
      badNum: D([{ id: 'a', type: 'shape', x: 'left-ish', w: 1, h: 1 }]),
      newer: JSON.stringify({ format: 'localeditor-design', version: 2, pages: [{}] }),
      noFormat: JSON.stringify({ version: 1, pages: [{}] }),
      notJson: '{ nope',
      oversize: 'x'.repeat(LE.design.LIMITS.json + 1),
      tooManyPages: JSON.stringify({ format: 'localeditor-design', version: 1, pages: Array.from({ length: 51 }, () => ({ layers: [] })) }),
      unknownIcon: D([{ id: 'i', type: 'icon', icon: 'lucide:not-a-real-icon-xyz', w: 10 }]),
      unknownRecipe: D([{ id: 'p', type: 'image', slot: true, recipe: 'no-such-recipe', w: 10, h: 10 }])
    };
    const out = {};
    for (const k of Object.keys(tries)) {
      const res = await LE.design.parse(tries[k]);
      out[k] = { ok: res.ok, project: !!res.project, paths: res.errors.map((e) => e.path), msg: res.errors[0] && res.errors[0].message };
    }
    out.polluted = ({}).polluted;
    return out;
  });
  Object.keys(r).filter((k) => k !== 'polluted').forEach((k) => {
    h.assert(!r[k].ok && !r[k].project, k + ' should be rejected');
    h.assert(r[k].msg && r[k].msg.length > 10, k + ' needs a plain message');
  });
  h.assert(r.script.paths[0] === '/pages/0/layers/0/text', 'script path: ' + r.script.paths[0]);
  h.assert(r.html.paths[0] === '/pages/0/layers/0/name', 'html path');
  h.assert(r.unknownType.paths[0] === '/pages/0/layers/0/type', 'type path');
  h.assert(r.proto.paths[0] === '/pages/0/layers/0/__proto__', 'proto path: ' + r.proto.paths[0]);
  h.assert(r.ctor.paths[0] === '/pages/0/layers/0/params/constructor', 'constructor path');
  h.assert(r.jsUrl.paths[0] === '/pages/0/layers/0/src', 'src path');
  h.assert(r.svgScript.paths[0] === '/pages/0/layers/0/svg', 'svg path');
  h.assert(r.dup.paths[0] === '/pages/0/layers/1/id', 'duplicate id path');
  h.assert(r.badNum.paths[0] === '/pages/0/layers/0/x', 'x path');
  h.assert(r.newer.paths[0] === '/version' && /newer/.test(r.newer.msg), 'newer version');
  h.assert(r.unknownIcon.paths[0] === '/pages/0/layers/0/icon', 'icon path: ' + r.unknownIcon.paths[0]);
  h.assert(r.polluted === undefined, 'prototype was polluted');
  h.assert.noErrors(page);
};

cases['remote image URLs are listed with their host and never fetched without consent'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const TINY_PNG = await tinyPng(page);
  const hits = [];
  await page.route('https://images.example.com/**', (route) => { hits.push(route.request().url()); route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(TINY_PNG.split(',')[1], 'base64') }); });
  const r = await page.evaluate(async () => {
    const res = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 800, height: 800,
      background: { type: 'image', src: 'https://images.example.com/bg.png' },
      layers: [{ id: 'p', type: 'image', src: 'https://images.example.com/a.png', x: 0, y: 0, w: 400, h: 400 }, { id: 'q', type: 'image', src: 'https://other.example.org/b.png', x: 0, y: 0, w: 10, h: 10 }] }] }));
    await new Promise((r) => setTimeout(r, 300));
    const before = { ok: res.ok, remote: res.remote.map((x) => [x.host, x.refs.length]), src: res.project.pages[0].layers[0].src, bg: res.project.pages[0].background.type };
    await LE.design.fetchRemote(res, ['images.example.com']);
    return { before, after: { src: res.project.pages[0].layers[0].src, q: res.project.pages[0].layers[1].src, bg: res.project.pages[0].background, assets: Object.keys(res.assets).length } };
  });
  h.assert(r.before.ok, 'parse ok');
  h.assert(r.before.remote.some((x) => x[0] === 'images.example.com') && r.before.remote.some((x) => x[0] === 'other.example.org'), 'hosts listed');
  h.assert.equal(r.before.src, '', 'no photo before consent');
  h.assert(hits.length === 2, 'only the allowed host is fetched, after consent: ' + hits.length);
  h.assert(/^[a-f0-9]{64}$/.test(r.after.src), 'allowed image filled in');
  h.assert.equal(r.after.q, '', 'other host stays empty');
  h.assert.equal(r.after.bg.type, 'image', 'background photo filled in');
  h.assert.noErrors(page);
};

cases['round trips are byte-stable: sample, collage, photo background, recipe photo, multi-page'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, 'design');
  const r = await page.evaluate(async () => {
    const c = window.LEStudio;
    async function trip(label) {
      c.syncProject();
      const p = c.S.project;
      const e1 = await LE.design.exportText(p, { images: 'embed' });
      const a = await LE.design.parse(e1.text);
      if (!a.ok) return { label, error: JSON.stringify(a.errors[0]) };
      const e2 = await LE.design.exportText(a.project, { images: 'embed', blobs: a.assets });
      const b = await LE.design.parse(e2.text);
      const e3 = await LE.design.exportText(b.project, { images: 'embed', blobs: b.assets });
      const pathsA = LE.design.stringify(a.project, { images: 'paths' }).text, pathsB = LE.design.stringify(b.project, { images: 'paths' }).text;
      return { label, same: e1.text === e2.text && e2.text === e3.text, pathsSame: pathsA === pathsB, layers: a.project.pages.reduce((n, pg) => n + pg.layers.length, 0), pages: a.project.pages.length, warnings: a.warnings.filter((w) => w.kind === 'sanitised').length };
    }
    const out = [];
    c.addText({ text: 'Round trip', size: 64 });
    out.push(await trip('sample'));
    // Recipe-applied photo through the shorthand.
    const base = c.baseLayer();
    const rec = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 100, height: 100, layers: [{ id: 'x', type: 'image', slot: true, recipe: { id: 'vintage-film', strength: 60 }, w: 10, h: 10 }] }] }));
    const look = rec.project.pages[0].layers[0];
    c.scene.update(base.id, { adjust: look.adjust, filter: look.filter });
    out.push(await trip('recipe'));
    // Photo background with framing.
    c.scene.setBackground({ type: 'image', src: base.src, fit: 'tile', color: '#f0e0d0', tile: { size: 0.3, gap: 0.05 }, blur: 4, dim: { color: '#000000', amount: 0.2 }, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, adjust: { brightness: 10 } });
    out.push(await trip('photo-background'));
    // Multi-page.
    c.addPage();
    await new Promise((r) => setTimeout(r, 200));
    c.addShape('star');
    out.push(await trip('multi-page'));
    // Collage from pool photos.
    const data = await LE.collage.photos();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const ph = data.photos[i * 4];
      const blob = await (await fetch('/' + ph.file)).blob();
      ids.push((await c.ingest(new File([blob], ph.id + '.jpg', { type: 'image/jpeg' }))).id);
    }
    LEStudioCollage.createGrid(c, ids, {});
    await new Promise((r) => setTimeout(r, 300));
    const col = await trip('collage');
    col.collage = !!c.scene.collage();
    out.push(col);
    return out;
  });
  r.forEach((x) => {
    h.assert(!x.error, x.label + ': ' + x.error);
    h.assert(x.same, x.label + ': project → text → project → text is not byte-identical');
    h.assert(x.pathsSame, x.label + ': paths mode not stable');
    h.assert(!x.warnings, x.label + ': sanitiser changed something');
  });
  h.assert(r.find((x) => x.label === 'multi-page').pages >= 2, 'multi-page kept its pages');
  h.assert(r.find((x) => x.label === 'collage').collage, 'collage meta present');
  h.assert.noErrors(page);
};

cases['side maps fold onto layers, unfold on read, and variables survive'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, 'design');
  const r = await page.evaluate(async () => {
    const c = window.LEStudio;
    await LE.assets.load('lucide');
    const icon = c.addSvg('lucide:heart');
    const qr = c.addSvg('qr:code', null, { markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h2v2H0z" fill="#000"/></svg>', noRecent: true });
    const base = c.baseLayer();
    const st = c.studio();
    st.icons = { [icon]: { style: 'duo', name: 'heart', palette: 'p1', color: '#ff0000', colors: ['#111111', '#222222'] } };
    st.qr = { [qr]: { text: 'https://example.com', fg: '#17131f', bg: '#ffffff', ec: 'M' } };
    st.fx = { [base.id]: { src: base.src, kind: 'duotone', a: '#112233', b: '#ddeeff', amount: 0.8 } };
    st.variables = [{ key: 'name', label: 'Name', type: 'text', default: 'Ana' }, { key: 'photo', label: 'Photo', type: 'image' }];
    c.syncProject();
    const p = c.S.project;
    const text = (await LE.design.exportText(p, { images: 'embed' })).text;
    const doc = JSON.parse(text);
    const L = (id) => doc.pages[0].layers.find((l) => l.id === id);
    const back = await LE.design.parse(text);
    const m = back.project.meta.studio;
    // Variables through the sanitiser alone, and through the studio save → reopen path.
    const v = LE.project.validate(JSON.parse(JSON.stringify(p)));
    await c.saveNow();
    const reopened = await LE.project.open(p.id);
    return {
      iconStyle: L(icon).iconStyle, qrOut: L(qr).qr, qrSvg: !!L(qr).svg, iconSvg: 'svg' in L(icon), fx: L(base.id).fx && L(base.id).fx.kind,
      fxSrc: L(base.id).fx && L(base.id).fx.src.slice(0, 11), varsOut: doc.variables,
      unfolded: { icons: m.icons && m.icons[icon] && m.icons[icon].palette, qr: m.qr && m.qr[qr] && m.qr[qr].text, fx: m.fx && m.fx[base.id] && m.fx[base.id].kind, fxSrc: m.fx && m.fx[base.id] && m.fx[base.id].src === base.src },
      varsBack: m.variables, varsValidate: v.project.meta.studio.variables, varsReopen: reopened.meta.studio.variables,
      again: LE.design.stringify(back.project, { images: 'ids' }).text === LE.design.stringify(back.project, { images: 'ids' }).text
    };
  });
  h.assert.equal(r.iconStyle.palette, 'p1', 'icon side data folded onto the layer');
  h.assert(!r.iconSvg, 'icons are written by asset id, never as inline SVG');
  h.assert.equal(r.qrOut.text, 'https://example.com', 'qr side data folded');
  h.assert(r.qrSvg, 'qr keeps its markup (no catalogue id)');
  h.assert.equal(r.fx, 'duotone', 'fx folded'); h.assert.equal(r.fxSrc, 'data:image/', 'fx source embedded');
  h.assert.equal(r.unfolded.icons, 'p1'); h.assert.equal(r.unfolded.qr, 'https://example.com'); h.assert.equal(r.unfolded.fx, 'duotone'); h.assert(r.unfolded.fxSrc, 'fx src maps back to the asset id');
  const want = JSON.stringify([{ key: 'name', label: 'Name', type: 'text', default: 'Ana' }, { key: 'photo', label: 'Photo', type: 'image' }]);
  h.assert.equal(JSON.stringify(r.varsOut), want, 'variables written');
  h.assert.equal(JSON.stringify(r.varsBack), want, 'variables read back');
  h.assert.equal(JSON.stringify(r.varsValidate), want, 'variables survive LE.project.validate');
  h.assert.equal(JSON.stringify(r.varsReopen), want, 'variables survive save and reopen');
  h.assert.noErrors(page);
};

cases['lint reports overflow, off-page, missing image, unknown font and low contrast'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async () => {
    const res = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 1000, height: 1000, background: '#ffffff', layers: [
      { id: 'over', type: 'text', text: 'This text is far too long for such a small box and will overflow it', font: 'Inter', size: 60, x: 10, y: 10, w: 300, h: 60 },
      { id: 'away', type: 'shape', shape: 'rectangle', fill: '#000', x: 2000, y: 0, w: 100, h: 100 },
      { id: 'gone', type: 'image', src: 'a'.repeat(64), x: 0, y: 0, w: 100, h: 100 },
      { id: 'font', type: 'text', text: 'Hi', font: 'Comic Sans MS', size: 40, x: 10, y: 500, w: 300 },
      { id: 'pale', type: 'text', text: 'Pale', font: 'Inter', size: 40, color: '#eeeeee', x: 10, y: 700, w: 300 },
      { id: 'card', type: 'shape', shape: 'rectangle', fill: '#111111', x: 500, y: 500, w: 400, h: 300 },
      { id: 'dark', type: 'text', text: 'Dark on dark', font: 'Inter', size: 40, color: '#222222', x: 520, y: 520, w: 300 },
      { id: 'fine', type: 'text', text: 'Readable', font: 'Inter', size: 40, color: '#ffffff', x: 520, y: 650, w: 300 }
    ] }] }));
    const kinds = {};
    res.warnings.forEach((w) => { (kinds[w.layer || '-'] = kinds[w.layer || '-'] || []).push(w.kind); });
    const again = LE.design.lint(res.project).map((w) => w.kind);
    return { ok: res.ok, kinds, again };
  });
  h.assert(r.ok, 'parse ok');
  h.assert(r.kinds.over && r.kinds.over.includes('overflow'), 'overflow');
  h.assert(r.kinds.away && r.kinds.away.includes('off-page'), 'off-page');
  h.assert(r.kinds.gone && r.kinds.gone.includes('missing-image'), 'missing image');
  h.assert(r.kinds.font && r.kinds.font.includes('unknown-font'), 'unknown font');
  h.assert(r.kinds.pale && r.kinds.pale.includes('low-contrast'), 'low contrast on page');
  h.assert(r.kinds.dark && r.kinds.dark.includes('low-contrast'), 'low contrast on a shape');
  h.assert(!r.kinds.fine, 'readable text is not flagged');
  h.assert(r.again.includes('overflow') && r.again.includes('low-contrast'), 'lint() works on a project alone');
  h.assert.noErrors(page);
};

cases['studio opens design files, keeps the open design on errors, and saves them'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  await h.need(page, 'design');
  const text = fs.readFileSync(path.join(EX_DIR, 'summer-sale-post.ledesign.json'), 'utf8');
  const before = await page.evaluate(() => window.LEStudio.S.project.id);
  // A broken file: plain-language problem with its path, open design untouched.
  await page.evaluate(() => LE.design.studioImport(window.LEStudio, new File([JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ layers: [{ id: 'x', type: 'video' }] }] })], 'broken.ledesign.json', { type: 'application/json' })));
  await page.waitForSelector('.sxd-errs li');
  const err = await page.evaluate(() => ({ text: document.querySelector('.sxd-errs').textContent, id: window.LEStudio.S.project.id }));
  h.assert(/\/pages\/0\/layers\/0\/type/.test(err.text) && /Unknown layer type/.test(err.text), 'error shows path and message');
  h.assert.equal(err.id, before, 'failed import did not touch the open design');
  await page.click('.sxd-ask [data-ok]');
  // The File menu entry and the hidden picker.
  await page.click('.sx-file-btn');
  await page.waitForSelector('[data-cmd="openDesignFile"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-cmd="openDesignFile"]')]);
  await chooser.setFiles({ name: 'summer.ledesign.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForFunction((id) => window.LEStudio.S.project && window.LEStudio.S.project.id !== id && window.LEStudio.scene.layers().some((l) => l.id === 'title'), before);
  const opened = await page.evaluate(() => ({ name: window.LEStudio.S.project.name, ids: window.LEStudio.scene.layers().map((l) => l.id) }));
  h.assert.equal(opened.name, 'Summer sale post');
  h.assert(opened.ids.includes('sun-icon') && opened.ids.includes('offer'), 'layers keep their ids');
  // Drag-drop routing goes through addFiles.
  await page.evaluate((t) => window.LEStudio.addFiles([new File([t.replace('Summer sale post', 'Dropped design')], 'drop.json', { type: 'application/json' })]), text);
  await page.waitForFunction(() => window.LEStudio.S.project.name === 'Dropped design');
  // Save as design file: sizes shown, one gold button, download produces parseable JSON.
  await page.click('.sx-file-btn');
  await page.click('[data-cmd="saveDesignFile"]');
  await page.waitForFunction(() => { const b = document.querySelector('.sxd-save [data-go]'); return b && !b.disabled; });
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.sxd-choice em')].map((e) => e.textContent));
  h.assert(sizes.every((s) => /\d/.test(s)), 'sizes shown: ' + sizes.join(', '));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sxd-save [data-go]')]);
  h.assert(/\.ledesign\.json$/.test(dl.suggestedFilename()), 'file name ' + dl.suggestedFilename());
  const saved = fs.readFileSync(await dl.path(), 'utf8');
  const back = await page.evaluate((t) => LE.design.parse(t).then((r) => ({ ok: r.ok, n: r.project.pages[0].layers.length })), saved);
  h.assert(back.ok && back.n === 7, 'saved file opens again');
  h.assert.noErrors(page);
};

cases['phone: save dialog fits at 360 px with no sideways scroll'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'small');
  await page.evaluate(() => LE.design.saveDialog(window.LEStudio));
  await page.waitForSelector('.sxd-save');
  await page.waitForTimeout(400);
  h.assert(await h.noOverflow(page), 'save dialog scrolls sideways at 360');
  const small = await page.evaluate(() => [...document.querySelectorAll('.sxd-save button')].filter((b) => b.getBoundingClientRect().height < 43.5).map((b) => b.textContent));
  h.assert(!small.length, 'touch targets under 44 px: ' + small.join(', '));
  h.assert.noErrors(page);
};

module.exports = cases;
