/* QA walk-through (not part of the regression run): a first-time user on a phone, with a screenshot at every step.
 * Usage: node tests/qa/phone-walk.js [phone|small] [outDir]
 * Prints a measurement line per step (tap targets, covered controls) next to the screenshot path. */
'use strict';
const path = require('path');
const fs = require('fs');
const h = require('../lib/harness');

const vp = process.argv[2] || 'phone';
const OUT = process.argv[3] || '/tmp/claude-0/-home-user-localeditor/8967b802-9271-5685-b2c3-5bd639496365/scratchpad/qa';
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
async function shot(page, label) {
  n++;
  const f = path.join(OUT, vp + '-' + String(n).padStart(2, '0') + '-' + label + '.png');
  await page.screenshot({ path: f });
  const m = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const small = [...document.querySelectorAll('button, [role=tab], input[type=range], a.btn, .sx-tile, .sx-filter')].filter((e) => vis(e) && e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return (r.width < 40 || r.height < 40) && !e.closest('.sx-sw'); }).length;
    const total = [...document.querySelectorAll('button')].filter(vis).length;
    const sheet = document.getElementById('sx-panel'); const sr = sheet && !sheet.hidden ? sheet.getBoundingClientRect() : null;
    return { smallTargets: small, buttons: total, sheetTop: sr ? Math.round(sr.top) : null, sheetH: sr ? Math.round(sr.height) : null, overflowX: document.documentElement.scrollWidth - innerWidth, vh: innerHeight };
  });
  console.log(String(n).padStart(2, '0') + ' ' + label + ' ' + JSON.stringify(m) + ' -> ' + f);
}
const tap = async (page, sel, opts) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded().catch(() => {}); await l.tap(opts); await page.waitForTimeout(450); };

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  const page = await h.open(browser, base, '/studio/', vp);
  page.setDefaultTimeout(8000);
  await page.waitForSelector('.sx-size-card');
  await shot(page, 'A0-start');

  /* A. Instagram post from a photo with a caption */
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-s=open]').tap()]);
  await fc.setFiles(h.PHOTO(1));
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1);
  await page.waitForTimeout(700);
  await shot(page, 'A1-photo-opened');
  await tap(page, '#sx-tabs [data-panel-btn=design]');
  await shot(page, 'A2-design-sheet');
  await page.locator('#sx-panel-body [role=tab]', { hasText: 'Resize' }).tap().catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, 'A3-resize-tab');
  await page.locator('.sx-size-mini', { hasText: 'Instagram post' }).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.locator('.sx-size-mini', { hasText: 'Instagram post' }).first().tap().catch(async (e) => console.log('  resize tap failed: ' + e.message.split('\n')[0]));
  await page.waitForTimeout(700);
  await shot(page, 'A4-size-preview');
  await page.locator('#sx-bar [data-cmd=sizeUse]').tap().catch((e) => console.log('  Use this size not tappable: ' + e.message.split('\n')[0]));
  await page.waitForTimeout(600);
  await shot(page, 'A5-size-applied');
  await tap(page, '#sx-tabs [data-panel-btn=text]');
  await shot(page, 'A6-text-sheet');
  await page.locator('.sx-ta-h').tap();
  await page.waitForTimeout(700);
  await shot(page, 'A7-heading-added-editing');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Sunday in the hills');
  await shot(page, 'A8-caption-typed');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await shot(page, 'A9-caption-committed');
  const lay = (await h.layers(page)).find((l) => l.type === 'text');
  const r = await h.rect(page, lay.id);
  await h.touchDrag(page, { x: r.left + r.width * 0.28, y: r.top + r.height / 2 }, { x: r.left + r.width * 0.28, y: r.top + r.height / 2 + 150 }, 10);
  await shot(page, 'A10-caption-dragged-down');
  await page.waitForTimeout(1500); // a human takes a moment; an instant tap after a synthetic fling is swallowed by Chrome

  /* D. export and share */
  await page.locator('#sx-head .sx-download').tap();
  await page.waitForTimeout(600);
  await shot(page, 'D1-export-sheet');
  const hasShare = await page.evaluate(() => /share/i.test(document.getElementById('sx-panel-body').innerText));
  console.log('  share option visible in Export: ' + hasShare);
  await page.locator('#sx-panel-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.waitForTimeout(300);
  await shot(page, 'D2-export-sheet-scrolled');
  const dl = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.locator('#sx-panel-body .btn-gold.btn-lg').tap()]);
  await page.waitForTimeout(800);
  await shot(page, 'D3-after-download-tap');
  console.log('  download event: ' + (dl[0] ? dl[0].suggestedFilename() : 'none'));

  /* B. 4-photo collage */
  await page.evaluate(() => window.LEStudio.cmd('newDesign'));
  await page.waitForSelector('#sx-start:not([hidden])');
  await shot(page, 'B0-start-again');
  await page.locator('.sx-size-card').first().tap();
  await page.waitForTimeout(500);
  await tap(page, '#sx-tabs [data-panel-btn=apps]');
  await shot(page, 'B1-apps-sheet');
  const collageBtn = page.locator('#sx-panel-body button', { hasText: /collage/i }).first();
  if (await collageBtn.count()) { await collageBtn.tap(); await page.waitForTimeout(700); await shot(page, 'B2-collage-chooser'); }
  await tap(page, '#sx-tabs [data-panel-btn=design]');
  await page.locator('.sx-cg-chip', { hasText: 'Collage' }).first().tap().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'B3-design-collage-chip');
  await page.locator('#sx-panel-body .sx-cg-card').first().tap().catch((e) => console.log('  no card to tap: ' + e.message.split('\n')[0]));
  await page.waitForTimeout(1500);
  await shot(page, 'B4-collage-applied');
  const layers = await h.layers(page);
  console.log('  collage layers: ' + layers.length + ' images: ' + layers.filter((l) => l.type === 'image').length + ' slots: ' + layers.filter((l) => l.slot).length);
  const slot = layers.find((l) => l.slot);
  if (slot) {
    await page.evaluate(() => window.LEStudio.closePanel());
    await page.waitForTimeout(400);
    const rr = await h.rect(page, slot.id);
    await page.touchscreen.tap(rr.left + rr.width / 2, rr.top + rr.height / 2);
    await page.waitForTimeout(500);
    await shot(page, 'B5-slot-selected');
  }

  /* C. remove / replace a background */
  await page.evaluate(() => window.LEStudio.cmd('newDesign'));
  await page.waitForSelector('#sx-start:not([hidden])');
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-s=open]').tap()]);
  await fc2.setFiles(h.PHOTO(0));
  await page.waitForFunction(() => window.LEStudio.scene.layers().length === 1);
  await page.waitForTimeout(700);
  await tap(page, '#sx-tabs [data-panel-btn=background]');
  await shot(page, 'C1-background-sheet');
  await page.locator('#sx-panel-body').evaluate((e) => e.scrollTo(0, 400)).catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'C2-background-sheet-scrolled');
  const names = await page.locator('#sx-panel-body button').allInnerTexts();
  console.log('  background buttons: ' + names.map((s) => s.trim()).filter(Boolean).slice(0, 24).join(' | '));
  await page.evaluate(() => window.LEStudio.closePanel());
  await page.waitForTimeout(300);
  const l0 = (await h.layers(page))[0];
  const rc = await h.rect(page, l0.id);
  await page.touchscreen.tap(rc.left + rc.width / 2, rc.top + rc.height / 2);
  await page.waitForTimeout(500);
  await shot(page, 'C3-photo-selected');
  await tap(page, '#sx-tool [data-cmd=more]');
  await shot(page, 'C4-more-menu');
  await page.keyboard.press('Escape');
  await tap(page, '#sx-tool [data-cmd=replace]').catch(() => {});
  await shot(page, 'C5-replace-sheet');
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
