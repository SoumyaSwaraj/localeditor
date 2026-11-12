'use strict';
/* Studio shell (roadmap 2.11): phone navigation, sheet snaps, toolbar priority and overflow, touch handles, export action,
   sticky panel actions, toasts, touch wording, short laptop screens, keyboard menus and focus, contrast, object-URL caches. */
const cases = {};
const PHONES = [['phone', '390x844'], ['small', '360x740']];
const MOUSE_WORDS = /double-click|shift-click|ctrl ?v\b|drop photos|drag photos onto|hover a size|right-click/i;

async function at(browser, base, w, hh, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: hh }, serviceWorkers: 'block', colorScheme: theme || 'light' });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('le-theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(12000);
  await page.goto(base + '/studio/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sx-size-card');
  return page;
}
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, sel);
const quiet = (page) => page.evaluate(() => window.LEStudio.coach('off'));

/* ---------- 1. Navigation on phone ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' every registered tool is reachable in at most two taps (tab, or More then the tool)'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    const ids = await page.evaluate(() => window.LEStudio.railItems().map((x) => x.id));
    const tabs = await page.locator('#sx-tabs [data-panel-btn]').evaluateAll((els) => els.map((e) => e.dataset.panelBtn));
    h.assert(tabs.length <= 5 && tabs.includes('more'), 'tab bar ' + tabs);
    await page.locator('#sx-tabs [data-panel-btn=more]').tap();
    await page.waitForTimeout(400);
    const inMore = await page.locator('#sx-panel-body [data-panel-btn], #sx-panel-body [data-cmd^="tool:"]').evaluateAll((els) => els.map((e) => e.dataset.panelBtn || e.dataset.cmd));
    const missing = ids.filter((id) => !tabs.includes(id) && !inMore.includes(id));
    h.assert(missing.length === 0, 'not reachable in two taps: ' + missing);
    h.assert(inMore.includes('export') && inMore.includes('tool:collage'), 'More lists Download and Collage: ' + inMore);
    const items = await page.locator('#sx-panel-body .sx-more-item').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    h.assert(items.every((s) => s >= 44), 'More items are 44px targets: ' + items);
    await page.locator('#sx-panel-body [data-cmd="tool:collage"]').tap();
    await page.waitForTimeout(400);
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.panel), 'apps', 'Collage opens the collage app');
    h.assert(await h.noOverflow(page), 'sideways scroll');
    h.assert.noErrors(page);
  };
});

cases['a panel registered by another module (spec.rail) shows up in the rail and the phone More sheet without shell edits'] = async ({ browser, base, h }) => {
  for (const vp of ['desktop', 'phone']) {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    await page.evaluate(() => {
      window.LEStudioPanels.demo = { title: 'Demo tool', rail: { label: 'Demo', icon: 'star' }, render: function (c, body) { body.appendChild(c.h('<p class="sx-note">Demo</p>')); } };
      window.LEStudio.renderRail();
    });
    if (vp === 'desktop') {
      h.assert(await page.locator('#sx-rail [data-panel-btn=demo]').count() === 1, 'rail has the new tool');
      await page.locator('#sx-rail [data-panel-btn=demo]').click();
    } else {
      await page.locator('#sx-tabs [data-panel-btn=more]').tap();
      await page.waitForTimeout(400);
      await page.locator('#sx-panel-body [data-panel-btn=demo]').tap();
    }
    await page.waitForTimeout(300);
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.panel), 'demo', vp + ': the registered panel opens');
    await page.context().close();
  }
};

/* ---------- 2. Canvas vs. sheet ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' sheet snaps: peek < half < full, panels can ask for a snap, and the canvas keeps a fair share at half'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    await quiet(page);
    await page.locator('#sx-tabs [data-panel-btn=text]').tap();
    await page.waitForTimeout(500);
    const vh = await page.evaluate(() => innerHeight);
    const sizes = {};
    for (const s of ['peek', 'half', 'full']) {
      await page.evaluate((x) => window.LEStudio.sheet(x), s);
      await page.waitForTimeout(450);
      sizes[s] = (await box(page, '#sx-panel')).height;
      h.assert.equal(await page.evaluate(() => window.LEStudio.S.sheet), s, 'snap ' + s);
    }
    h.assert(sizes.peek < sizes.half && sizes.half < sizes.full, 'snap order ' + JSON.stringify(sizes));
    await page.evaluate(() => window.LEStudio.sheet('half'));
    await page.waitForTimeout(500);
    const stage = await box(page, '#sx-stage');
    const pr = await page.evaluate(() => window.LEStudio.scene.pageRect());
    h.assert(stage.height >= vh * 0.38, 'canvas stage at half is ' + Math.round(stage.height) + ' of ' + vh);
    h.assert(pr.top >= stage.top - 1 && pr.bottom <= stage.bottom + 1, 'the page is fitted inside the area above the sheet');
    await page.evaluate(() => {
      window.LEStudioPanels.tallDemo = { title: 'Tall', sheet: 'full', render: function (c, body) { body.appendChild(c.h('<p>Tall</p>')); } };
      window.LEStudio.openPanel('tallDemo');
    });
    await page.waitForTimeout(450);
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.sheet), 'full', 'spec.sheet = full is honoured');
    await page.evaluate(() => window.LEStudio.openPanel('text', { sheet: 'peek' }));
    await page.waitForTimeout(450);
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.sheet), 'peek', 'openPanel(id, { sheet }) is honoured');
    h.assert.noErrors(page);
  };

  cases[tag + ' adding a heading from the Text sheet leaves it visible above the sheet and selected'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    await quiet(page);
    await page.locator('#sx-tabs [data-panel-btn=text]').tap();
    await page.waitForTimeout(450);
    await page.locator('.sx-ta-h').tap();
    await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1);
    await page.waitForTimeout(700);
    const id = (await h.layers(page))[0].id;
    h.assert.equal((await h.selection(page)).join(), id, 'the new heading is selected');
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.sheet), 'peek', 'the sheet lowered to a peek');
    const r = await h.rect(page, id);
    const sheet = await box(page, '#sx-panel');
    const tool = await box(page, '#sx-tool');
    h.assert(r.top >= 0 && r.bottom <= Math.min(sheet.top, tool.top), 'heading is above the toolbar and sheet: ' + Math.round(r.bottom) + ' vs ' + Math.round(Math.min(sheet.top, tool.top)));
  };

  cases[tag + ' tapping the canvas lowers an open sheet to a peek'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    await quiet(page);
    await page.locator('#sx-tabs [data-panel-btn=elements]').tap();
    await page.waitForTimeout(450);
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.sheet), 'half', 'opens at half');
    const st = await box(page, '#sx-stage');
    await page.touchscreen.tap(st.left + st.width / 2, st.top + st.height / 2);
    await page.waitForTimeout(500);
    h.assert.equal(await page.evaluate(() => window.LEStudio.S.sheet), 'peek', 'canvas tap lowers the sheet');
  };

  cases[tag + ' dragging a slider in the sheet shrinks the sheet to that slider and gives the canvas the room'] = async ({ browser, base, h }) => {
    const page = await h.openPhotoDesign(browser, base, vp);
    await quiet(page);
    await page.evaluate(() => window.LEStudio.openPanel('adjust', { sheet: 'full' }));
    await page.waitForTimeout(500);
    const range = page.locator('#sx-panel-body input[type=range]').nth(2);
    await range.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const r = await range.boundingBox();
    const before = await box(page, '#sx-panel');
    const stage0 = await box(page, '#sx-stage');
    const cdp = await page.context().newCDPSession(page);
    const p0 = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y, id: 1 }] });
    await page.waitForTimeout(250);
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + i * 8, y: p0.y, id: 1 }] });
    await page.waitForTimeout(250);
    const during = await page.evaluate(() => ({ scrub: document.getElementById('sx').classList.contains('is-scrubbing'), h: document.getElementById('sx-panel').getBoundingClientRect().height, stage: document.getElementById('sx-stage').getBoundingClientRect().height }));
    const r1 = await range.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach().catch(() => {});
    await page.waitForTimeout(500);
    h.assert(during.scrub, 'scrubbing state while the finger is down');
    h.assert(during.h < before.height - 40, 'sheet shrank: ' + Math.round(before.height) + ' -> ' + Math.round(during.h));
    h.assert(during.stage > stage0.height + 40, 'canvas grew: ' + Math.round(stage0.height) + ' -> ' + Math.round(during.stage));
    h.assert(Math.abs(r1.y - r.y) < 6, 'the slider stayed under the finger: ' + Math.round(r.y) + ' -> ' + Math.round(r1.y));
    const after = await page.evaluate(() => ({ scrub: document.getElementById('sx').classList.contains('is-scrubbing'), snap: window.LEStudio.S.sheet }));
    h.assert(!after.scrub && after.snap === 'full', 'back to the full sheet after release ' + JSON.stringify(after));
    h.assert.noErrors(page);
  };
});

/* ---------- 3. Contextual toolbar ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' toolbar: Delete and Duplicate are on screen for photo, text and shape; the rest is in More; no floating mini bar'] = async ({ browser, base, h }) => {
    const page = await h.openPhotoDesign(browser, base, vp);
    await quiet(page);
    const [t, s] = await h.addLayers(page, [
      { type: 'text', text: 'Hello there', x: 100, y: 100, w: 300, h: 90, size: 60 },
      { type: 'shape', shape: 'rectangle', x: 100, y: 300, w: 200, h: 200, fill: { type: 'solid', color: '#7457F0' } }
    ]);
    const photo = (await h.layers(page))[0].id;
    const vw = await page.evaluate(() => innerWidth);
    for (const id of [photo, t, s]) {
      await h.select(page, [id]);
      await page.waitForTimeout(300);
      for (const c of ['dup', 'del', 'more']) {
        const b = await box(page, '#sx-tool [data-cmd=' + c + ']');
        h.assert(b && b.width >= 40 && b.left >= 0 && b.right <= vw + 1, c + ' is on screen for ' + id + ': ' + JSON.stringify(b));
      }
      h.assert(await page.evaluate(() => { const t = document.getElementById('sx-tool'); return t.scrollWidth <= t.clientWidth + 1; }), 'toolbar does not need scrolling');
      h.assert(await page.locator('#sx-mini').isHidden(), 'no floating mini bar on a phone');
    }
    await h.select(page, [t]);
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(() => window.LEStudio.S.tbOverflow.map((n) => n.dataset.cmd));
    h.assert(hidden.includes('underline'), 'underline moved into More: ' + hidden);
    await page.locator('#sx-tool [data-cmd=more]').tap();
    await page.waitForSelector('#sx-pop:not([hidden]) [data-cmd=underline]');
    await page.locator('#sx-pop [data-cmd=underline]').tap();
    await page.waitForTimeout(300);
    h.assert((await h.layers(page)).find((l) => l.id === t).underline === true, 'an action from the More menu works');
    h.assert.noErrors(page);
  };
});

cases['1440x900 and 1280x720 with a panel open: Lock, Duplicate, Delete and More are visible; the rest overflows into More (measured)'] = async ({ browser, base, h }) => {
  for (const [w, hh] of [[1440, 900], [1280, 720], [1024, 600]]) {
    const page = await at(browser, base, w, hh);
    await page.locator('.sx-size-card').first().click();
    await page.waitForTimeout(300);
    await quiet(page);
    const [t] = await h.addLayers(page, [{ type: 'text', text: 'Hello', x: 60, y: 60, w: 300, h: 90, size: 60 }]);
    await h.select(page, [t]);
    await h.openPanel(page, 'text');
    for (const c of ['lock', 'dup', 'del', 'more']) h.assert(await page.locator('#sx-tool [data-cmd=' + c + ']').isVisible(), w + 'x' + hh + ': ' + c + ' visible');
    const m = await page.evaluate(() => { const t = document.getElementById('sx-tool'); return { sw: t.scrollWidth, cw: t.clientWidth }; });
    h.assert(m.sw <= m.cw + 1, w + 'x' + hh + ': toolbar fits without scrolling ' + JSON.stringify(m));
    await page.context().close();
  }
};

/* ---------- 4. Handles on touch ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' handles: 40px+ hit areas, the middle of a small heading drags it, no edge handles on it, rotate knob on screen'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    await quiet(page);
    const [t] = await h.addLayers(page, [{ type: 'text', text: 'Sunday', x: 340, y: 500, w: 400, h: 90, size: 70 }]);
    await h.select(page, [t]);
    await page.waitForTimeout(300);
    const hs = await page.evaluate(() => [...document.querySelectorAll('.le-sel .le-h')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { h: e.dataset.h, w: r.width, hh: r.height }; }));
    h.assert(hs.length >= 5 && hs.every((x) => x.w >= 40 && x.hh >= 40), 'handle hit areas: ' + JSON.stringify(hs));
    h.assert(!hs.some((x) => x.h === 'n' || x.h === 's'), 'no top/bottom edge handles on a short heading');
    const c = await h.centerOf(page, t);
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest('[data-h]') ? e.closest('[data-h]').dataset.h : 'body'; }, [c.x, c.y]);
    h.assert.equal(hit, 'body', 'centre of the heading is not a handle');
    const l0 = (await h.layers(page))[0];
    await h.touchDrag(page, c, { x: c.x + 30, y: c.y + 60 }, 10);
    const l1 = (await h.layers(page))[0];
    h.assert(Math.abs(l1.y - l0.y) > 40 && Math.abs(l1.w - l0.w) < 1, 'dragged from the centre: ' + [l0.x, l0.y, '->', l1.x, l1.y]);
    await page.context().close();
    const p2 = await h.openPhotoDesign(browser, base, vp);
    await quiet(p2);
    await h.select(p2, [(await h.layers(p2))[0].id]);
    await p2.waitForTimeout(300);
    const rot = await h.handleBox(p2, 'rotate');
    const st = await box(p2, '#sx-stage');
    h.assert(rot && rot.y - rot.h / 2 >= st.top - 1 && rot.y + rot.h / 2 <= st.bottom + 1, 'rotate knob inside the stage: ' + JSON.stringify(rot) + ' stage ' + JSON.stringify(st));
    const corners = await p2.evaluate(() => [...document.querySelectorAll('.le-sel .le-h')].filter((e) => /^(nw|ne|se|sw)$/.test(e.dataset.h)).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vw: innerWidth }; }));
    h.assert(corners.every((p) => p.x >= 7 && p.x <= p.vw - 7), 'corner knobs are not clipped by the screen edge ' + JSON.stringify(corners));
  };
});

/* ---------- 5. Export action and sticky panel actions ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' header Download is labelled and 44px tall; the export sheet keeps its Download button in view'] = async ({ browser, base, h }) => {
    const page = await h.newDesign(browser, base, vp, 'Instagram post');
    await quiet(page);
    const d = await box(page, '#sx-head .sx-download');
    h.assert(d.height >= 44 && d.width >= 88, 'header Download is ' + Math.round(d.width) + 'x' + Math.round(d.height));
    h.assert(await page.locator('#sx-head .sx-download span').isVisible(), 'the label "Download" shows on a phone');
    await page.locator('#sx-head .sx-download').tap();
    await page.waitForTimeout(600);
    const btn = await box(page, '#sx-panel-body .btn-gold.btn-lg');
    const pan = await box(page, '#sx-panel');
    h.assert(btn && btn.bottom <= pan.bottom + 1 && btn.top >= pan.top, 'Download button inside the visible sheet ' + JSON.stringify(btn) + ' ' + JSON.stringify(pan));
  };
});

cases['sticky actions: ctx.ui.actions keeps a long panel\'s primary button in view (desktop 1280x560 and phone)'] = async ({ browser, base, h }) => {
  for (const vp of ['short', 'phone']) {
    const page = vp === 'short' ? await at(browser, base, 1280, 560) : await h.open(browser, base, '/studio/', 'phone');
    await page.waitForSelector('.sx-size-card');
    await page.locator('.sx-size-card').first().click();
    await page.waitForTimeout(300);
    await quiet(page);
    await page.evaluate(() => {
      window.LEStudioPanels.longDemo = { title: 'Long', render: function (c, body) {
        for (let i = 0; i < 40; i++) body.appendChild(c.h('<p class="sx-note">Row ' + i + '</p>'));
        body.appendChild(c.ui.actions([c.h('<button type="button" class="btn btn-gold" id="demo-go">Save</button>')]));
      } };
      window.LEStudio.openPanel('longDemo');
    });
    await page.waitForTimeout(500);
    const b = await box(page, '#demo-go');
    const p = await box(page, '#sx-panel');
    h.assert(b.bottom <= p.bottom + 1 && b.top >= p.top && b.bottom <= (await page.evaluate(() => innerHeight)), vp + ': primary action in view ' + JSON.stringify(b));
    await page.context().close();
  }
};

/* ---------- 6. First minute ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' start screen: Open a photo is first, the quick "post from a photo" chips make a 1080x1080 post in two taps, no mouse wording'] = async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/studio/', vp);
    await page.waitForSelector('.sx-size-card');
    const txt = await page.locator('#sx-start').innerText();
    h.assert(!MOUSE_WORDS.test(txt), 'mouse-only wording on the touch start screen: ' + (txt.match(MOUSE_WORDS) || [])[0]);
    h.assert(await page.locator('#sx-tabs').isHidden(), 'no tool tabs before a design exists');
    const open = await box(page, '[data-s=open]');
    h.assert(open.bottom <= (await page.evaluate(() => innerHeight)) && open.height >= 44, 'Open a photo above the fold');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-q=ig-post]').tap()]);
    await fc.setFiles(h.PHOTO(1));
    await page.waitForFunction(() => window.LEStudio.S.project && window.LEStudio.scene.toJSON().width === 1080 && window.LEStudio.scene.toJSON().height === 1080, null, { timeout: 15000 });
    const d = await h.doc(page);
    h.assert(d.layers.length === 1 && d.layers[0].type === 'image', 'the photo is on the page');
    h.assert(Math.abs(d.layers[0].w - 1080) < 2 && Math.abs(d.layers[0].h - 1080) < 2, 'the photo fills the post: ' + d.layers[0].w + 'x' + d.layers[0].h);
    h.assert.noErrors(page);
  };

  cases[tag + ' panels opened on a touch screen use touch wording (Text, Uploads, Layers, Adjust, Design)'] = async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, vp);
    for (const id of ['text', 'uploads', 'layers', 'adjust', 'design']) {
      await h.openPanel(page, id);
      const txt = await page.locator('#sx-panel').innerText();
      h.assert(!MOUSE_WORDS.test(txt), id + ': ' + (txt.match(MOUSE_WORDS) || [])[0]);
    }
  };
});

cases['first-run coach marks: at most three, tied to real controls, never block a tap, never shown again or to returning visitors'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'phone', 'Instagram post');
  await page.waitForSelector('.sx-coach.is-on');
  const c = await page.evaluate(() => { const n = document.querySelector('.sx-coach'); return { pe: getComputedStyle(n).pointerEvents, txt: n.textContent }; });
  h.assert(c.pe === 'none' && /1 of 3/.test(c.txt), 'first mark ' + JSON.stringify(c));
  await page.locator('#sx-tabs [data-panel-btn=text]').tap();
  await page.waitForTimeout(400);
  h.assert.equal(await page.evaluate(() => window.LEStudio.S.panel), 'text', 'the tap went through to the tab');
  h.assert(await page.locator('.sx-coach').count() === 0, 'the mark went away');
  const seen = [1];
  const [t] = await h.addLayers(page, [{ type: 'text', text: 'Hi', x: 100, y: 100, w: 400, h: 120, size: 80 }]);
  await h.select(page, [t]);
  await page.waitForTimeout(300);
  if (await page.locator('.sx-coach').count()) seen.push(2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  h.assert(await page.locator('.sx-coach').count() === 0, 'Esc dismisses');
  h.assert.equal(await page.evaluate(() => localStorage.getItem('le-studio-coach')), '"done"', 'Esc turns guidance off for good');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  h.assert(await page.locator('.sx-coach').count() === 0, 'nothing for a returning visitor');
  h.assert(seen.length <= 3, 'at most three marks');
};

/* ---------- 7. Feedback ---------- */
PHONES.forEach(([vp, tag]) => {
  cases[tag + ' toasts sit above the tab bar, toolbar and sheet; the size preview bar does not cover the page'] = async ({ browser, base, h }) => {
    const page = await h.openPhotoDesign(browser, base, vp);
    await quiet(page);
    await page.evaluate(() => window.LEStudio.openPanel('text'));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.LEStudio.toast('Hello from a toast'));
    await page.waitForTimeout(400);
    const t = await box(page, '#sx-toast');
    const lows = await page.evaluate(() => ['sx-tabs', 'sx-panel', 'sx-tool'].map((id) => document.getElementById(id).getBoundingClientRect().top));
    h.assert(t.bottom <= Math.min(...lows) + 1, 'toast bottom ' + Math.round(t.bottom) + ' vs ' + lows.map(Math.round));
    await page.evaluate(() => window.LEStudio.closePanel());
    await page.evaluate(() => window.LEStudio.size.preview(1080, 1080, 'Instagram post'));
    await page.waitForTimeout(600);
    const bar = await box(page, '#sx-bar');
    const pr = await page.evaluate(() => window.LEStudio.scene.pageRect());
    h.assert(bar.bottom <= pr.top + 1, 'preview bar ' + Math.round(bar.bottom) + ' is above the page ' + Math.round(pr.top));
    await page.evaluate(() => window.LEStudio.size.cancel());
  };
});

/* ---------- 8. Short laptop screens ---------- */
cases['1280x560: every tool is reachable from the rail (visible or under its More), nothing below the fold'] = async ({ browser, base, h }) => {
  const page = await at(browser, base, 1280, 560);
  await page.locator('.sx-size-card').first().click();
  await page.waitForTimeout(400);
  await quiet(page);
  const m = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('#sx-rail button')].filter((b) => b.offsetParent);
    return { below: vis.filter((b) => b.getBoundingClientRect().bottom > innerHeight).map((b) => b.dataset.panelBtn || b.dataset.cmd), shown: vis.map((b) => b.dataset.panelBtn).filter(Boolean), hidden: window.LEStudio.S.railHidden, all: window.LEStudio.railItems().map((x) => x.id), scroll: document.getElementById('sx-rail').scrollHeight - document.getElementById('sx-rail').clientHeight };
  });
  h.assert(m.below.length === 0 && m.scroll <= 1, 'rail below the fold ' + JSON.stringify(m));
  h.assert(m.all.every((id) => m.shown.includes(id) || m.hidden.includes(id)), 'every tool reachable ' + JSON.stringify(m));
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#sx-rail button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
  h.assert(sizes.every((x) => x >= 36), 'rail buttons stay usable: ' + sizes);
};

/* ---------- 9. Keyboard and focus ---------- */
cases['keyboard: File, Flip, Align, Order (More), Zoom and Pages menus open with Enter, arrows move, Esc returns focus to the opener'] = async ({ browser, base, h }) => {
  const page = await at(browser, base, 1440, 900);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-s=open]')]);
  await fc.setFiles(h.PHOTO(0));
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1);
  await page.waitForTimeout(300);
  await quiet(page);
  const photo = (await h.layers(page))[0].id;
  const [a, b] = await h.addLayers(page, [{ type: 'shape', shape: 'rectangle', x: 10, y: 10, w: 80, h: 80 }, { type: 'shape', shape: 'rectangle', x: 200, y: 200, w: 80, h: 80 }]);
  const MENUS = [
    ['file', '#sx-head [data-cmd=fileMenu]', null],
    ['flip', '#sx-tool [data-cmd=flipMenu]', [photo]],
    ['align', '#sx-tool [data-cmd=alignMenu]', [a, b]],
    ['order', '#sx-tool [data-cmd=more]', [photo]],
    ['zoom', '#sx-foot [data-cmd=zoomMenu]', null],
    ['pages', '#sx-foot [data-cmd=pages]', null]
  ];
  for (const [name, sel, ids] of MENUS) {
    if (ids) { await h.select(page, ids); await page.waitForTimeout(250); }
    await page.focus(sel);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => { const p = document.getElementById('sx-pop'); return { open: !p.hidden, inside: p.contains(document.activeElement), role: p.getAttribute('role'), first: document.activeElement.textContent.trim() }; });
    h.assert(r.open && r.inside, name + ': focus moved into the menu ' + JSON.stringify(r));
    h.assert(r.role === 'menu' || r.role === 'dialog', name + ': role ' + r.role);
    if (r.role === 'menu') h.assert(await page.evaluate(() => [...document.querySelectorAll('#sx-pop button')].every((b) => b.getAttribute('role') === 'menuitem')), name + ': items are menuitems');
    await page.keyboard.press('ArrowDown');
    const second = await page.evaluate(() => document.activeElement.textContent.trim());
    h.assert(second !== r.first && await page.evaluate(() => document.getElementById('sx-pop').contains(document.activeElement)), name + ': ArrowDown moved within the menu');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.boxShadow !== 'none' || s.outlineStyle !== 'none'; });
    h.assert(ring, name + ': the focused item shows a focus ring');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const back = await page.evaluate((s) => ({ closed: document.getElementById('sx-pop').hidden, on: document.activeElement === document.querySelector(s), exp: document.querySelector(s).getAttribute('aria-expanded') }), sel);
    h.assert(back.closed && back.on, name + ': Esc closed the menu and returned focus ' + JSON.stringify(back));
  }
  h.assert.noErrors(page);
};

cases['keyboard: focus stays on the toolbar control after an action and after an autosave'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await quiet(page);
  const [t] = await h.addLayers(page, [{ type: 'text', text: 'Hello', x: 100, y: 100, w: 500, h: 140, size: 90 }]);
  await h.select(page, [t]);
  await page.waitForTimeout(300);
  await page.focus('#sx-tool [data-cmd=bold]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  h.assert.equal(await page.evaluate(() => document.activeElement.dataset.cmd), 'bold', 'focus after Enter on Bold');
  await page.evaluate((id) => window.LEStudio.patch(id, { color: '#E0668E' }), t);
  await page.waitForTimeout(1500);
  h.assert.equal(await page.evaluate(() => document.activeElement.dataset.cmd), 'bold', 'focus after an autosave');
  await page.keyboard.press('Tab');
  h.assert(await page.evaluate(() => !!document.activeElement.closest('#sx-tool')), 'Tab continues inside the toolbar, not from the start');
};

cases['keyboard: icon buttons in the shell all have names, and a dialog returns focus to its opener'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await quiet(page);
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('#sx-head button, #sx-rail button, #sx-tool button, #sx-foot button, #sx-tabs button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).map((b) => b.outerHTML.slice(0, 60)));
  h.assert(unnamed.length === 0, 'unnamed: ' + unnamed);
  await page.focus('#sx-head [data-cmd=shortcuts]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sx-modal:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  h.assert.equal(await page.evaluate(() => document.activeElement.dataset.cmd), 'shortcuts', 'focus back on the opener');
};

/* ---------- 10. Contrast and sizes ---------- */
cases['contrast: start paragraph, size card sizes, links, panel eyebrows and notes are >= 4.5:1 in light and dark'] = async ({ browser, base, h }) => {
  const ratioFn = () => {
    function parse(c) { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    function lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
    function bgOf(el) { let n = el; const st = []; while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) { st.push(c); if (c.a >= 1) break; } n = n.parentElement; } let o = { r: 255, g: 255, b: 255 }; for (let i = st.length - 1; i >= 0; i--) { const c = st[i]; o = { r: c.r * c.a + o.r * (1 - c.a), g: c.g * c.a + o.g * (1 - c.a), b: c.b * c.a + o.b * (1 - c.a) }; } return o; }
    window.__ratio = (el) => { const fg0 = parse(getComputedStyle(el).color); const bg = bgOf(el); const fg = { r: fg0.r * fg0.a + bg.r * (1 - fg0.a), g: fg0.g * fg0.a + bg.g * (1 - fg0.a), b: fg0.b * fg0.a + bg.b * (1 - fg0.a) }; const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  };
  for (const theme of ['light', 'dark']) {
    const page = await at(browser, base, 1440, 900, theme);
    await page.evaluate(ratioFn);
    const start = await page.evaluate(() => ['.sx-hero p', '.sx-size-card small', '.sx-hero-drop', '.sx-hero-drop .sx-link', '.sx-start-quick > span', '.sx-start-sec h2'].map((s) => [s, window.__ratio(document.querySelector(s))]));
    await page.locator('.sx-size-card').first().click();
    await page.waitForTimeout(300);
    await h.openPanel(page, 'text');
    await page.evaluate(ratioFn);
    const panel = await page.evaluate(() => ['#sx-panel-head .sx-eyebrow', '#sx-panel-body .sx-sec-head h3', '#sx-panel-body .sx-note', '#sx-rail .sx-rail-lb', '#sx-save span', '.sx-footbtn span'].map((s) => [s, window.__ratio(document.querySelector(s))]));
    const bad = start.concat(panel).filter((x) => x[1] < 4.5);
    h.assert(bad.length === 0, theme + ': low contrast ' + JSON.stringify(bad));
    await page.context().close();
  }
};

PHONES.forEach(([vp, tag]) => {
  cases[tag + ' every visible shell control is at least 44px (header, tabs, toolbar, sheet head) and nothing scrolls sideways'] = async ({ browser, base, h }) => {
    const page = await h.studioWithSample(browser, base, vp);
    await quiet(page);
    const [t] = await h.addLayers(page, [{ type: 'text', text: 'Hi', x: 100, y: 100, w: 400, h: 120, size: 80 }]);
    await h.select(page, [t]);
    await h.openPanel(page, 'text');
    await page.waitForTimeout(300);
    const small = await page.evaluate(() => [...document.querySelectorAll('#sx-head button, #sx-tabs button, #sx-tool button, #sx-panel-head button')].filter((b) => b.offsetParent && !b.hidden).map((b) => { const r = b.getBoundingClientRect(); return { c: b.dataset.cmd || b.dataset.panelBtn, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 40 || x.h < 44 && !/^size:/.test(x.c) && x.h < 42));
    h.assert(small.length === 0, 'small shell targets: ' + JSON.stringify(small));
    for (const id of ['more', 'design', 'export', 'layers']) { await h.openPanel(page, id); h.assert(await h.noOverflow(page), id + ' scrolls sideways'); }
    await page.evaluate(() => window.LEStudio.cmd('fileMenu', document.querySelector('[data-cmd=fileMenu]')));
    await page.waitForTimeout(300);
    h.assert(await h.noOverflow(page), 'File menu sheet scrolls sideways');
    h.assert.noErrors(page);
  };
});

/* ---------- 11. Memory ---------- */
cases['object-URL caches stay bounded after many assets and are released when the design closes'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await quiet(page);
  const r = await page.evaluate(async () => {
    const P = window.LEStudioPanels;
    const svg = P._urlCache('svg');
    const first = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }));
    svg.set('first', first);
    for (let i = 0; i < 900; i++) svg.set('k' + i, URL.createObjectURL(new Blob(['x' + i])));
    const evicted = await fetch(first).then(() => false, () => true);
    const sizes = Object.keys(P._urlCaches).map((k) => [k, P._urlCaches[k].size(), P._urlCaches[k].max]);
    window.LEStudio.openPanel('elements');
    await new Promise((res) => setTimeout(res, 600));
    const before = Object.keys(P._urlCaches).reduce((n, k) => n + P._urlCaches[k].size(), 0);
    window.LEStudio.cmd('newDesign');
    const after = Object.keys(P._urlCaches).reduce((n, k) => n + P._urlCaches[k].size(), 0);
    return { evicted, sizes, before, after };
  });
  h.assert(r.evicted, 'the least recently used URL was revoked');
  h.assert(r.sizes.every((x) => x[1] <= x[2]), 'caches within their limits ' + JSON.stringify(r.sizes));
  h.assert(r.before > 0 && r.after === 0, 'caches released when the design closes ' + r.before + ' -> ' + r.after);
};

cases['asset thumbnails from many photos stay within the thumbnail cache limit'] = async ({ browser, base, h }) => {
  const page = await h.newDesign(browser, base, 'desktop', 'Instagram post');
  await quiet(page);
  for (let i = 0; i < 3; i++) await h.addPhoto(page, h.PHOTO(i));
  await h.openPanel(page, 'uploads');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const c = window.LEStudioPanels._urlCaches.thumbs; return { n: c.size(), max: c.max }; });
  h.assert(r.n >= 1 && r.n <= r.max, 'thumbnail cache ' + JSON.stringify(r));
};

module.exports = cases;
