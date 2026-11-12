'use strict';
/* Thumbnail kit (Apps -> Thumbnail): cut-out + bold headline in eight 1280x720 layouts, all as editable layers. */
const cases = {};

async function studioWithPhoto(browser, base, h, viewport, photo) {
  const page = await h.open(browser, base, '/studio/', viewport || 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene && window.LEStudioCutout);
  await page.evaluate(async (p) => {
    const b = await (await fetch('/assets/photos/collage/' + p + '.jpg')).blob();
    await LEStudio.newFromPhoto(new File([b], p + '.jpg', { type: 'image/jpeg' }));
  }, photo || 'people-07');
  await page.waitForTimeout(300);
  return page;
}

cases['every layout builds editable layers at 1280x720'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'desktop', 'street-02');
  const r = await page.evaluate(async () => {
    const photo = LEStudio.scene.layers().find((x) => x.type === 'image').src;
    const mask = await LEStudioCutout.thumbnail.cut(photo);
    const out = [];
    for (const lay of LEStudioCutout.thumbnail.layouts()) {
      const d = await LEStudioCutout.thumbnail.build(lay.id, { photo, mask, headline: 'I tried it for 30 days' });
      const subject = d.layers.find((l) => l.name === 'Subject');
      const head = d.layers.find((l) => l.name === 'Headline');
      out.push({ id: lay.id, w: d.width, h: d.height, subject: subject && subject.cutout && subject.cutout.asset === mask && !!subject.cutout.outline, head: head && head.type === 'text' && head.text.replace(/\n/g, ' ') === 'I tried it for 30 days',
        size: head && head.size, inside: head && head.x >= 0 && head.x + head.w <= 1280 && head.y >= 0 && head.y + head.h <= 720, types: d.layers.map((l) => l.type) });
    }
    return { mask, out };
  });
  h.assert(/^[a-f0-9]{64}$/.test(r.mask), 'No mask');
  h.assert(r.out.length >= 6 && r.out.length <= 8, 'Expected 6-8 layouts, got ' + r.out.length);
  r.out.forEach((o) => {
    h.assert(o.w === 1280 && o.h === 720, o.id + ' size');
    h.assert(o.subject, o.id + ': subject should be an image layer with the cut-out and an outline');
    h.assert(o.head, o.id + ': headline text layer');
    h.assert(o.size >= 64, o.id + ': headline too small to read at 320 px (' + o.size + ')');
    h.assert(o.inside, o.id + ': headline box leaves the page');
    h.assert(o.types.every((t) => ['image', 'text', 'shape'].indexOf(t) >= 0), o.id + ': only normal layer types');
  });
  /* Create one: a new 1280x720 design whose layers are ordinary and selectable. */
  const made = await page.evaluate(async () => {
    const photo = LEStudio.S.project.pages[0].layers.find((x) => x.type === 'image').src;
    const mask = await LEStudioCutout.thumbnail.cut(photo);
    await LEStudioCutout.thumbnail.create('bold-right', { photo, mask, headline: 'Hidden secrets' });
    const d = LEStudio.scene.toJSON();
    const head = d.layers.find((l) => l.name === 'Headline');
    LEStudio.scene.select([head.id]);
    LEStudio.patch(head.id, { text: 'Edited' });
    return { w: d.width, h: d.height, n: d.layers.length, edited: LEStudio.scene.layer(head.id).text, assets: Object.keys(LEStudio.S.project.assets).length, name: LEStudio.S.project.name };
  });
  h.assert(made.w === 1280 && made.h === 720, 'Design size');
  h.assert.equal(made.edited, 'Edited');
  h.assert(made.assets >= 2, 'Photo and mask should be in the new design');
  h.assert(/^Thumbnail/.test(made.name), 'Design name: ' + made.name);
  h.assert.noErrors(page);
};

cases['the Apps panel lists Thumbnail and the kit works at phone width'] = async ({ browser, base, h }) => {
  const page = await studioWithPhoto(browser, base, h, 'phone', 'people-07');
  await h.openPanel(page, 'apps');
  const names = await page.evaluate(() => [...document.querySelectorAll('.sx-app b')].map((b) => b.textContent));
  h.assert(names.indexOf('Thumbnail') >= 0, 'Apps: ' + names.join(', '));
  await page.evaluate(() => [...document.querySelectorAll('.sx-app')].find((b) => /Thumbnail/.test(b.textContent)).click());
  await page.waitForSelector('.sxc-tk-head');
  h.assert(await h.noOverflow(page), 'Sideways scroll');
  await page.evaluate(() => [...document.querySelectorAll('#sx-panel-body .btn-gold')].find((b) => /Cut out the subject/.test(b.textContent)).click());
  await page.waitForSelector('.sxc-tk-card', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.sxc-tk-canvas').length >= 8, null, { timeout: 30000 });
  const cards = await page.evaluate(() => [...document.querySelectorAll('.sxc-tk-card')].map((c) => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
  h.assert(cards.length >= 6 && cards.every((c) => c.h >= 44), 'Layout cards: ' + JSON.stringify(cards));
  h.assert(await h.noOverflow(page), 'Sideways scroll with previews');
  await page.fill('.sxc-tk-head', 'Big news');
  await page.waitForTimeout(700);
  await page.waitForFunction(() => document.querySelectorAll('.sxc-tk-canvas').length >= 8, null, { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('.sxc-tk-card')[2].click());
  await page.waitForFunction(() => LEStudio.scene.toJSON().width === 1280);
  const d = await h.doc(page);
  h.assert.equal(d.height, 720);
  h.assert(d.layers.some((l) => l.type === 'text' && /Big news/i.test(l.text.replace(/\n/g, ' '))), 'Headline not applied');
  h.assert(d.layers.some((l) => l.type === 'image' && l.cutout), 'Subject cut-out missing');
  h.assert(await h.noOverflow(page), 'Sideways scroll after create');
  h.assert.noErrors(page);
};

module.exports = cases;
