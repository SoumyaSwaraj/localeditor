'use strict';
/* Cross-module checks owned by the architect: things one feature stores that another module must keep. */
module.exports = {
  'project files keep recipe looks (1.1 adjust keys and the applied-recipe note)': async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, 'desktop');
    const out = await page.evaluate(() => {
      const doc = window.LEStudio.scene.toJSON();
      const img = doc.layers.find((l) => l.type === 'image');
      img.adjust = { fade: 20, clarity: 15, splitShadowHue: 220, splitShadowAmount: 30, gamma: 1.1, evil: 5,
        recipe: { id: 'golden-hour', name: 'Golden <b>Hour', strength: 78, add: { fade: 20, bogus: 1 }, prev: { gamma: null }, filter: true, prevFilter: { name: 'mono', intensity: 50 }, __x: 1 } };
      const res = window.LE.project.validate({ schema: window.LE.project.SCHEMA || 'localeditor-project', v: 1, pages: [doc], assets: {} });
      if (!res.ok) return { err: res.errors };
      return res.project.pages[0].layers.find((l) => l.type === 'image').adjust;
    });
    h.assert(!out.err, 'Project did not validate: ' + JSON.stringify(out.err));
    h.assert.equal(out.fade, 20); h.assert.equal(out.clarity, 15); h.assert.equal(out.splitShadowHue, 220); h.assert.equal(out.gamma, 1.1);
    h.assert(out.evil === undefined, 'Unknown adjust key was kept');
    h.assert(out.recipe && out.recipe.id === 'golden-hour' && out.recipe.strength === 78, 'Recipe note was dropped');
    h.assert.equal(out.recipe.name, 'Golden bHour');
    h.assert(out.recipe.add.fade === 20 && out.recipe.add.bogus === undefined && out.recipe.__x === undefined, 'Recipe note was not cleaned');
    h.assert(out.recipe.prev.gamma === null && out.recipe.filter === true && out.recipe.prevFilter.name === 'mono', 'Recipe note fields lost');
  },
  'the editor draws the 1.1 adjustments itself, once': async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, 'desktop');
    const r = await page.evaluate(async () => {
      const s = window.LEStudio.scene;
      const id = s.layers().find((l) => l.type === 'image').id;
      const px = async () => { const c = await s.render(0.25); const d = c.getContext('2d').getImageData(20, 20, 1, 1).data; return [d[0], d[1], d[2]]; };
      const before = await px();
      s.update(id, { adjust: { fade: 60 } });
      const after = await px();
      return { flag: window.LE.Scene.EXTENDED_ADJUST === true, before, after };
    });
    h.assert(r.flag, 'EXTENDED_ADJUST is not set');
    h.assert(r.before.join() !== r.after.join(), 'Fade did not change the rendered photo');
    h.assert.noErrors(page);
  },
  'Reset adjustments clears every adjustment': async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, 'desktop');
    const left = await page.evaluate(async () => {
      const c = window.LEStudio, s = c.scene;
      const id = s.layers().find((l) => l.type === 'image').id;
      s.select([id]);
      s.update(id, { adjust: { brightness: 30, contrast: -10, fade: 12 } });
      c.openPanel('adjust');
      await new Promise((r) => setTimeout(r, 300));
      const b = [...document.querySelectorAll('#sx-panel-body button')].find((x) => /Reset adjustments/.test(x.textContent));
      if (!b) return 'no button';
      b.click();
      const a = s.layer(id).adjust || {};
      return Object.keys(a).filter((k) => a[k] != null && a[k] !== 0);
    });
    h.assert(Array.isArray(left) && left.length === 0, 'Adjustments left after reset: ' + JSON.stringify(left));
  }
};
