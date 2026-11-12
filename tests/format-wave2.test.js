'use strict';
/* Open design format: the wave 2 page and layer fields (carousel, maker, redact, cutout) read and write, and page
   ids that follow their page through delete and reorder. Asserts on documents. */
const cases = {};

async function studio(browser, base, h, vp) {
  const page = await h.open(browser, base, '/studio/', vp || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.design);
  return page;
}
const doc = (pages, extra) => JSON.stringify(Object.assign({ format: 'localeditor-design', version: 1, name: 'W2', pages }, extra || {}));
/* Two different real PNGs, as data: URIs (a photo and a mask). */
const pngs = (page) => page.evaluate(() => {
  const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return c.toDataURL('image/png'); };
  return {
    photo: mk(8, 6, (x) => { x.fillStyle = '#2b6cb0'; x.fillRect(0, 0, 8, 6); x.fillStyle = '#e53e3e'; x.fillRect(2, 2, 3, 3); }),
    mask: mk(8, 6, (x) => { x.fillStyle = '#fff'; x.fillRect(2, 1, 4, 4); })
  };
});

cases['carousel: read, normalised slide width, written back, byte-stable'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (text) => {
    const a = await LE.design.parse(text);
    if (!a.ok) return { errors: a.errors };
    const t1 = LE.design.stringify(a.project).text;
    const b = await LE.design.parse(t1);
    const bad = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 1000, height: 500, carousel: { slides: 40 }, layers: [] }] }));
    const odd = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 2000, height: 500, carousel: { slides: 2, slideWidth: 900 }, layers: [] }] }));
    return { car: a.project.pages[0].carousel, t1, stable: b.ok && LE.design.stringify(b.project).text === t1, bad: bad.errors.map((e) => e.path), odd: odd.ok && odd.project.pages[0].carousel, oddWarn: odd.warnings.map((w) => w.kind) };
  }, doc([{ id: 'deck', width: 3240, height: 1350, carousel: { slides: 3 }, layers: [{ id: 't', type: 'text', text: 'Swipe', x: 100, y: 100, w: 3000 }] }]));
  h.assert(!r.errors, 'parse failed: ' + JSON.stringify(r.errors));
  h.assert.equal(JSON.stringify(r.car), JSON.stringify({ v: 1, slides: 3, slideWidth: 1080 }), 'carousel in the project');
  h.assert(/"carousel": \{ "slides": 3, "slideWidth": 1080 \}/.test(r.t1), 'carousel written: ' + r.t1.slice(0, 300));
  h.assert(r.stable, 'byte-stable');
  h.assert(r.bad.includes('/pages/0/carousel/slides'), 'slides out of range is an error with a pointer');
  h.assert(r.odd && r.odd.slideWidth === 1000 && r.oddWarn.includes('carousel-width'), 'mismatched slideWidth is corrected with a warning');
  h.assert.noErrors(page);
};

cases['maker: a page with only "maker" is generated; the result is written and reads back the same'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (text) => {
    const a = await LE.design.parse(text);
    if (!a.ok) return { errors: a.errors };
    const p = a.project.pages[0];
    const t1 = LE.design.stringify(a.project).text;
    const b = await LE.design.parse(t1);
    const unknown = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ maker: { id: 'no-such-maker' } }] }));
    return {
      maker: p.maker, n: p.layers.length, texts: p.layers.filter((l) => l.type === 'text').map((l) => l.text).join(' | '), size: [p.width, p.height],
      t1, stable: b.ok && LE.design.stringify(b.project).text === t1, again: b.ok && b.project.pages[0].layers.length, unknown: unknown.errors.map((e) => e.path)
    };
  }, doc([{ id: 'q', maker: { id: 'quote', values: { quote: 'Small steps every day.', author: 'Ana' } } }]));
  h.assert(!r.errors, 'parse failed: ' + JSON.stringify(r.errors));
  h.assert(r.n > 0, 'layers were generated');
  h.assert(/Small steps every day/.test(r.texts) && /Ana/.test(r.texts), 'the values are in the design: ' + r.texts);
  h.assert(r.maker && r.maker.id === 'quote' && r.maker.values.author === 'Ana' && r.maker.sig, 'maker meta kept with a signature: ' + JSON.stringify(r.maker));
  h.assert(r.size[0] >= 100 && r.size[1] >= 100, 'page takes the maker size');
  h.assert(/"maker": \{/.test(r.t1) && /"id": "quote"/.test(r.t1), 'maker written');
  h.assert(r.stable && r.again === r.n, 'with its layers written out, the page reads back unchanged (not regenerated)');
  h.assert(r.unknown.includes('/pages/0/maker'), 'an unknown maker is an error at the maker');
  h.assert.noErrors(page);
};

cases['redact: shape redaction reads, writes and is checked'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async (text) => {
    const a = await LE.design.parse(text);
    if (!a.ok) return { errors: a.errors };
    const t1 = LE.design.stringify(a.project).text;
    const b = await LE.design.parse(t1);
    const bad = await LE.design.parse(JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 500, height: 500, layers: [{ id: 'r', type: 'shape', x: 0, y: 0, w: 10, h: 10, redact: { mode: 'smudge' } }] }] }));
    return { l: a.project.pages[0].layers.map((l) => l.redact || null), t1, stable: b.ok && LE.design.stringify(b.project).text === t1, bad: bad.errors.map((e) => e.path) };
  }, doc([{ width: 800, height: 600, layers: [
    { id: 'box', type: 'shape', x: 10, y: 10, w: 200, h: 60, redact: { mode: 'pixelate', amount: 18 } },
    { id: 'black', type: 'shape', x: 10, y: 100, w: 200, h: 60, redact: { mode: 'solid', color: '#000000' } }
  ] }]));
  h.assert(!r.errors, 'parse failed: ' + JSON.stringify(r.errors));
  h.assert.equal(JSON.stringify(r.l), JSON.stringify([{ mode: 'pixelate', amount: 18, color: '#17131F' }, { mode: 'solid', amount: 0, color: '#000000' }]), 'redact in the project');
  h.assert(/"redact": \{ "mode": "pixelate", "amount": 18 \}/.test(r.t1), 'written: ' + r.t1);
  h.assert(r.stable, 'byte-stable');
  h.assert(r.bad.includes('/pages/0/layers/0/redact/mode'), 'bad mode refused with a pointer');
  h.assert.noErrors(page);
};

cases['cutout: the mask is embedded or a path like any photo, round-trips, and is dropped in template links'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const img = await pngs(page);
  const r = await page.evaluate(async ([img]) => {
    const text = JSON.stringify({ format: 'localeditor-design', version: 1, name: 'Cut', pages: [{ width: 800, height: 600, layers: [
      { id: 'hero', type: 'image', src: img.photo, x: 0, y: 0, w: 800, h: 600, cutout: { src: img.mask, model: 'u2netp', feather: 2, outline: { color: '#ffffff', width: 6 } } }
    ] }] });
    const a = await LE.design.parse(text);
    if (!a.ok) return { errors: a.errors };
    const l = a.project.pages[0].layers[0];
    const embed = await LE.design.exportText(a.project, { blobs: a.assets });
    const e2 = await LE.design.parse(embed.text);
    const paths = await LE.design.exportText(a.project, { images: 'paths', blobs: a.assets });
    const files = {}; paths.assets.forEach((x) => { files[x.path] = x.blob; });
    const p2 = await LE.design.parse(paths.text, { resolve: (p) => files[p] || null });
    const paths2 = p2.ok ? LE.design.stringify(p2.project, { images: 'paths' }).text : '';
    const link = await LE.design.toLink(a.project);
    const back = await LE.design.fromLink(link.url);
    const inLink = await LE.design.parse(text, { link: true });
    return {
      cut: l.cutout, photo: l.src, maskKnown: !!a.project.assets[l.cutout && l.cutout.asset], maskBlob: !!a.assets[l.cutout && l.cutout.asset],
      embedHasMask: /"cutout": \{\s*"src": "data:image\/png;base64,/.test(embed.text), e2: e2.ok && e2.project.pages[0].layers[0].cutout,
      pathsList: paths.assets.map((x) => x.path), pathsCut: (() => { const d = JSON.parse(paths.text).pages[0].layers[0]; return /^assets\/.+\.png$/.test(d.cutout.src) && d.cutout.src !== d.src; })(), pathsStable: paths2 === paths.text,
      linkJson: link.json, linkCut: back.ok && back.project.pages[0].layers[0].cutout, inLinkCut: inLink.ok && inLink.project.pages[0].layers[0].cutout
    };
  }, [img]);
  h.assert(!r.errors, 'parse failed: ' + JSON.stringify(r.errors));
  h.assert(r.cut && /^[a-f0-9]{64}$/.test(r.cut.asset) && r.cut.asset !== r.photo, 'cutout points at its own mask asset');
  h.assert(r.cut.model === 'u2netp' && r.cut.feather === 2 && r.cut.outline && r.cut.outline.width === 6 && r.cut.enabled === true, 'fields kept: ' + JSON.stringify(r.cut));
  h.assert(r.maskKnown && r.maskBlob, 'the mask is a project asset with its bytes');
  h.assert(r.embedHasMask, 'embedded export carries the mask as a data: URI');
  h.assert(r.e2 && r.e2.asset === r.cut.asset, 'embedded file reads back to the same mask (same hash)');
  h.assert(r.pathsCut && r.pathsList.length === 2, 'path export lists the photo and the mask: ' + r.pathsList);
  h.assert(r.pathsStable, 'path export is byte-stable through a read');
  h.assert(!/cutout/.test(r.linkJson) && !r.linkCut, 'template links drop the cut-out with the photo');
  h.assert(!r.inLinkCut, 'a cut-out inside a link is not read');
  h.assert.noErrors(page);
};

cases['page ids follow their page through edit, delete and reorder in the studio'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const text = doc(['intro', 'middle', 'outro'].map((id, i) => ({ id, width: 600, height: 600, background: ['#ffeeee', '#eeffee', '#eeeeff'][i], layers: [{ id: 't' + i, type: 'text', text: id, x: 20, y: 20, w: 500 }] })));
  await page.evaluate((t) => LE.design.importText(window.LEStudio, t, { name: 'ids.ledesign.json' }), text);
  await page.waitForFunction(() => window.LEStudio.S.project && window.LEStudio.S.project.pages.length === 3);
  const ids = () => page.evaluate(() => {
    const c = window.LEStudio; c.syncProject();
    const d = JSON.parse(LE.design.stringify(c.S.project).text);
    return d.pages.map((p) => p.id + ':' + p.layers[0].text).join(',');
  });
  h.assert.equal(await ids(), 'intro:intro,middle:middle,outro:outro', 'read');
  /* Edit the first page (the scene rebuilds the page document), then delete it. */
  await page.evaluate(() => { const c = window.LEStudio; c.loadPage(0); c.scene.update('t0', { text: 'intro edited' }); c.syncProject(); });
  h.assert.equal(await ids(), 'intro:intro edited,middle:middle,outro:outro', 'an edit keeps the id');
  await page.evaluate(() => window.LEStudio.deletePage(0));
  h.assert.equal(await ids(), 'middle:middle,outro:outro', 'after delete, ids stay with their pages');
  /* Reorder the way the pages panel does it, then duplicate: the copy has no id. */
  await page.evaluate(() => { const c = window.LEStudio, p = c.S.project; c.syncProject(); const pg = p.pages.splice(1, 1)[0]; p.pages.splice(0, 0, pg); c.loadPage(0); });
  h.assert.equal(await ids(), 'outro:outro,middle:middle', 'after reorder, ids stay with their pages');
  await page.evaluate(() => { window.LEStudio.loadPage(0); window.LEStudio.addPage(true); });
  h.assert.equal(await ids(), 'outro:outro,undefined:outro,middle:middle', 'a duplicate starts without an id');
  /* The project file keeps them too. */
  const kept = await page.evaluate(async () => { const c = window.LEStudio; c.syncProject(); const v = LE.project.validate(JSON.parse(JSON.stringify(c.S.project))); return v.project.pages.map((p) => p.id || '-').join(','); });
  h.assert.equal(kept, 'outro,-,middle', 'project validation keeps page ids');
  h.assert.noErrors(page);
};

cases['schema/design-1.json lists every page and layer key the studio writes for wave 2 fields'] = async ({ browser, base, h }) => {
  const schema = require('../schema/design-1.json');
  const D = schema.$defs;
  const page = await studio(browser, base, h);
  const img = await pngs(page);
  const written = await page.evaluate(async ([img]) => {
    const text = JSON.stringify({ format: 'localeditor-design', version: 1, name: 'All', pages: [
      { id: 'a', width: 2160, height: 1080, carousel: { slides: 2 }, layers: [
        { id: 'hero', type: 'image', src: img.photo, x: 0, y: 0, w: 800, h: 600, cutout: { src: img.mask, model: 'u2netp', feather: 2, refine: 'none', enabled: false, outline: { color: '#ffffff', width: 6 } } },
        { id: 'box', type: 'shape', x: 10, y: 10, w: 200, h: 60, redact: { mode: 'blur', amount: 9, color: '#000000' } }] },
      { id: 'b', maker: { id: 'quote', values: { quote: 'Hi there', author: 'Ana' } } }
    ] });
    const a = await LE.design.parse(text);
    if (!a.ok) return { errors: a.errors };
    return JSON.parse((await LE.design.exportText(a.project, { blobs: a.assets })).text);
  }, [img]);
  h.assert(!written.errors, 'parse failed: ' + JSON.stringify(written.errors));
  const props = (def) => Object.keys((def && def.properties) || {});
  const typeDef = { image: D.imageLayer, shape: D.shapeLayer, text: D.textLayer, svg: D.svgLayer, icon: D.iconLayer, path: D.pathLayer, group: { properties: {} } };
  const bad = [];
  written.pages.forEach((p, pi) => {
    Object.keys(p).forEach((k) => { if (!props(D.page).includes(k)) bad.push('/pages/' + pi + '/' + k); });
    if (p.carousel) Object.keys(p.carousel).forEach((k) => { if (!props(D.carousel).includes(k)) bad.push('carousel/' + k); });
    if (p.maker) Object.keys(p.maker).forEach((k) => { if (!props(D.maker).includes(k)) bad.push('maker/' + k); });
    p.layers.forEach((l, li) => {
      const ok = props(D.common).concat(props(D.layer), props(typeDef[l.type]));
      Object.keys(l).forEach((k) => { if (!ok.includes(k)) bad.push('/pages/' + pi + '/layers/' + li + '/' + k); });
      if (l.cutout) Object.keys(l.cutout).forEach((k) => { if (!props(D.imageLayer.properties.cutout).includes(k)) bad.push('cutout/' + k); });
      if (l.redact) Object.keys(l.redact).forEach((k) => { if (!props(D.shapeLayer.properties.redact).includes(k)) bad.push('redact/' + k); });
    });
  });
  h.assert(written.pages[0].carousel && written.pages[1].maker && written.pages[0].layers[0].cutout && written.pages[0].layers[1].redact, 'all four fields were written');
  h.assert.equal(bad.length, 0, 'keys missing from the schema: ' + bad.join(', '));
  h.assert.noErrors(page);
};

module.exports = cases;
