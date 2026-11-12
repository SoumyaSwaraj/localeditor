'use strict';
/* Deep links into the two studios: /studio/?tool=<id> (TOOL_MAP in le-studio.js) and /pdf-studio/?panel=<id>&job=<job>.
   Feature pages launch through these, so each one has to land on the feature itself. */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PDF = path.join(ROOT, 'tests/fixtures/pdf-bulk/payslips-30.pdf');
const cases = {};

/* ---------- Photo studio ---------- */
const TOOLS = [
  ['brand', 'brand', {}],
  ['cutout', 'cutout', {}],
  ['remove-background', 'cutout', {}],
  ['redact', 'redact', {}],
  ['thumbnail', 'apps', { app: 'thumbnail' }],
  ['make', 'apps', { app: 'make' }],
  ['makers', 'apps', { app: 'make' }],
  ['export-sizes', 'export', { tab: 'sizes' }],
  ['carousel', 'export', { tab: 'slides' }],
  ['slides', 'export', { tab: 'slides' }],
  ['replay', 'export', { tab: 'replay' }],
  ['share', 'export', { tab: 'image' }],
  ['design-file', 'projects', {}],
  /* the older entries keep working */
  ['collage', 'apps', { app: 'collage' }],
  ['resize', 'design', { tab: 'sizes' }],
  ['metadata', 'apps', { app: 'metadata' }],
  ['export', 'export', {}],
];
for (const [tool, panel, opts] of TOOLS) {
  cases['/studio/?tool=' + tool + ' opens ' + panel + (Object.keys(opts).length ? ' ' + JSON.stringify(opts) : '')] = async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/studio/?tool=' + tool, 'desktop');
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.S && window.LEStudio.S.panel, null, { timeout: 15000 });
    const got = await page.evaluate(() => ({ panel: window.LEStudio.S.panel, opts: window.LEStudio.S.panelOpts || {} }));
    h.assert.equal(got.panel, panel, tool + ' panel');
    Object.keys(opts).forEach((k) => h.assert.equal(got.opts[k], opts[k], tool + ' ' + k));
    h.assert.noErrors(page);
  };
}

cases['/studio/?tool= with an unknown name opens no panel and does not break the start screen'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/?tool=not-a-tool', 'desktop');
  await page.waitForTimeout(800);
  h.assert.equal(await page.evaluate(() => window.LEStudio.S.panel), null, 'no panel');
  h.assert(await page.isVisible('.sx-start-inner'), 'start screen is showing');
  h.assert.noErrors(page);
};

cases['/studio/?tool=export-sizes on a phone opens the sheet on the Every size tab'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/studio/?tool=export-sizes', 'phone');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.S && window.LEStudio.S.panel === 'export', null, { timeout: 15000 });
  h.assert.equal(await page.evaluate(() => window.LEStudio.S.panelOpts.tab), 'sizes', 'tab');
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  h.assert.noErrors(page);
};

cases['the export deep links show their tab once a design is open'] = async ({ browser, base, h }) => {
  for (const [tool, selector] of [['export-sizes', '.sxe-size-chip'], ['carousel', '.sxe-stepper'], ['replay', '.sxe-make']]) {
    const page = await h.open(browser, base, '/studio/?tool=' + tool, 'desktop');
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.S && window.LEStudio.S.panel === 'export', null, { timeout: 15000 });
    await page.evaluate(() => window.LEStudio.useSample());
    await page.waitForFunction(() => window.LEStudio.scene.layers().length > 0);
    await page.evaluate((t) => { window.LEStudio.openPanel('export', { tab: { 'export-sizes': 'sizes', carousel: 'slides', replay: 'replay' }[t] }); }, tool);
    await page.waitForSelector(selector, { timeout: 8000 });
    h.assert.noErrors(page);
    await page.context().close();
  }
};

cases['/studio/?make= opens the form for each of the six makers, and says so for an unknown one'] = async ({ browser, base, h }) => {
  for (const id of ['quote', 'review', 'receipt', 'milestone', 'palette', 'film']) {
    const page = await h.open(browser, base, '/studio/?make=' + id, 'desktop');
    await page.waitForFunction(() => window.LEStudioMakers && window.LEStudioMakers.form(), null, { timeout: 15000 });
    h.assert.equal(await page.evaluate(() => window.LEStudioMakers.form().m.id), id, id);
    h.assert.noErrors(page);
    await page.context().close();
  }
  const page = await h.open(browser, base, '/studio/?make=not-a-maker', 'desktop');
  await page.waitForSelector('text=There is no maker called', { timeout: 10000 });
  h.assert.equal(await page.evaluate(() => window.LEStudioMakers.form()), null, 'no form');
};

/* ---------- PDF studio ---------- */
async function ready(page) {
  await page.waitForFunction(() => window.PS && document.body.classList.contains('ps-ready'), null, { timeout: 15000 });
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
}
async function chooseFile(page) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="intent"][data-intent="merge"]')]);
  await chooser.setFiles(PDF);
}

for (const job of ['protect', 'merge', 'split', 'watermark', 'compress']) {
  cases['/pdf-studio/?panel=bulk&job=' + job + ' opens the Bulk panel and that job, with no file needed'] = async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/pdf-studio/?panel=bulk&job=' + job, 'desktop');
    await ready(page);
    await page.waitForFunction(() => PS.S.panel === 'bulk', null, { timeout: 10000 });
    await page.waitForSelector('.pb-work:not([hidden])[data-job="' + job + '"]', { timeout: 10000 });
    h.assert.noErrors(page);
  };
}

cases['/pdf-studio/?panel=bulk opens the list of bulk jobs, and a job that does not exist is ignored'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/pdf-studio/?panel=bulk', 'desktop');
  await ready(page);
  await page.waitForFunction(() => PS.S.panel === 'bulk');
  h.assert(await page.isVisible('.pb-jobs'), 'job list');
  h.assert.equal(await page.locator('.pb-work:not([hidden])').count(), 0, 'no job open');
  const page2 = await h.open(browser, base, '/pdf-studio/?panel=bulk&job=nonsense', 'desktop');
  await ready(page2);
  await page2.waitForFunction(() => PS.S.panel === 'bulk');
  h.assert.equal(await page2.locator('.pb-work:not([hidden])').count(), 0, 'unknown job ignored');
  h.assert.noErrors(page);
  h.assert.noErrors(page2);
};

for (const [job, view] of [['redact', 'redact'], ['reveal', 'reveal'], ['safety', 'safety'], ['send', 'send'], ['find', 'redact']]) {
  cases['/pdf-studio/?panel=security&job=' + job + ' keeps the open-file prompt, then continues to Protect on that job'] = async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/pdf-studio/?panel=security&job=' + job, 'desktop');
    await ready(page);
    const before = await page.evaluate(() => ({ panel: PS.S.panel, pending: PS.pendingPanel, job: PS.pendingJob, pages: PS.S.pages.length }));
    h.assert.equal(before.panel, '', 'no panel yet: it needs a document');
    h.assert.equal(before.pending, 'security', 'panel remembered');
    h.assert.equal(before.job, job, 'job remembered');
    h.assert(await page.isVisible('#ps-empty'), 'the open-file prompt is still showing');
    await chooseFile(page);
    await page.waitForFunction(() => PS.S.panel === 'security', null, { timeout: 20000 });
    await page.waitForSelector('.sec-pane[data-view="' + view + '"]', { timeout: 10000 });
    if (job === 'find') await page.waitForSelector('.sec-findbox', { timeout: 5000 });
    h.assert.equal(await page.evaluate(() => PS.pendingPanel), null, 'pending cleared');
    h.assert.noErrors(page);
  };
}

cases['/pdf-studio/?panel=security without a job opens the Protect home after a file is chosen'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/pdf-studio/?panel=security', 'desktop');
  await ready(page);
  await chooseFile(page);
  await page.waitForFunction(() => PS.S.panel === 'security', null, { timeout: 20000 });
  await page.waitForSelector('.sec-pane[data-view="home"] .sec-entry', { timeout: 10000 });
  h.assert.noErrors(page);
};

cases['/pdf-studio/?panel=edit opens that panel once a file is chosen; panel=convert opens at once'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/pdf-studio/?panel=edit', 'desktop');
  await ready(page);
  h.assert.equal(await page.evaluate(() => PS.S.panel), '', 'waits');
  await chooseFile(page);
  await page.waitForFunction(() => PS.S.panel === 'edit', null, { timeout: 20000 });
  const page2 = await h.open(browser, base, '/pdf-studio/?panel=convert', 'desktop');
  await ready(page2);
  await page2.waitForFunction(() => PS.S.panel === 'convert');
  h.assert.noErrors(page);
  h.assert.noErrors(page2);
};

cases['/pdf-studio/?panel= with an unknown panel is ignored and the studio starts normally'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/pdf-studio/?panel=not-a-panel&job=redact', 'desktop');
  await ready(page);
  await page.waitForTimeout(500);
  h.assert.equal(await page.evaluate(() => PS.S.panel), '', 'no panel');
  h.assert.equal(await page.evaluate(() => PS.pendingPanel || null), null, 'nothing pending');
  h.assert(await page.isVisible('#ps-empty'), 'start screen');
  h.assert.noErrors(page);
};

cases['/pdf-studio/?panel=bulk&job=protect on a phone opens the job over the studio'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/pdf-studio/?panel=bulk&job=protect', 'phone');
  await ready(page);
  await page.waitForSelector('.pb-work:not([hidden])[data-job="protect"]', { timeout: 10000 });
  h.assert(await h.noOverflow(page), 'no sideways scroll');
  h.assert.noErrors(page);
};

module.exports = cases;
