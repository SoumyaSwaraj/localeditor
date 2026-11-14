'use strict';
/* Every page of the site (all tool pages) loads with an empty console and without sideways scroll at phone size; desktop is checked for console errors.
   Pages are checked in groups of 12 so no case nears the 90 s limit on a loaded machine (the site now has 70+ pages). */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dirs = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.html')) && !/^(studio|pdf-studio|convert-to-pdf|recipes|node_modules)$/.test(d)).sort();
const cases = {};
const SIZE = 12;
const groups = [];
for (let i = 0; i < dirs.length; i += SIZE) groups.push(dirs.slice(i, i + SIZE));
const label = (g, i) => ' (' + (i + 1) + ' of ' + groups.length + ': ' + g[0] + ' … ' + g[g.length - 1] + ')';

groups.forEach((group, gi) => {
  cases['tool and info pages: phone 390x844 has no console errors and no sideways scroll' + label(group, gi)] = async ({ browser, base, h }) => {
    const bad = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    for (const d of group) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await page.goto(base + '/' + d + '/', { waitUntil: 'load' });
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (errs.length) bad.push(d + ': console ' + errs[0].slice(0, 80));
      if (over > 1) bad.push(d + ': sideways scroll ' + over + 'px');
      await page.close();
    }
    await ctx.close();
    h.assert(bad.length === 0, bad.join(' | '));
  };
  cases['tool and info pages: desktop 1440x900 has no console errors, a title, one h1 and a main landmark' + label(group, gi)] = async ({ browser, base, h }) => {
    const bad = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    for (const d of group) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await page.goto(base + '/' + d + '/', { waitUntil: 'load' });
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => ({ title: document.title, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main, [role=main]').length }));
      if (errs.length) bad.push(d + ': console ' + errs[0].slice(0, 80));
      if (!info.title || info.h1 !== 1 || info.main < 1) bad.push(d + ': title/h1/main ' + JSON.stringify(info));
      await page.close();
    }
    await ctx.close();
    h.assert(bad.length === 0, bad.join(' | '));
  };
});

/* ---------- Site data audit (docs/SITE.md): every launch link in assets/data/site.json opens what its entry says ---------- */
const siteData = require('../scripts/build-pages').load();
const live = siteData.entries.filter(siteData.visible).filter((e) => e.launch);
/* A launch to the bare studio or PDF studio (no query) is a plain page load, checked with the page launches below. */
const bare = (e) => e.launch === 'studio/' || e.launch === 'pdf-studio/';
const studioLaunch = (e) => /^studio\//.test(e.launch) && !bare(e);
const pdfLaunch = (e) => /^pdf-studio\//.test(e.launch) && !bare(e);
const SEARCH = [
  ['blur background', 'photo-backgrounds/'], ['blur background', 'creative-effects/'], ['remove spots', 'portrait-retouching/'], ['make photo look like film', 'creative-effects/'],
  ['scan to pdf', 'scan-to-pdf/'], ['raw', 'raw-develop/'], ['hdr', 'hdr-merge/'], ['lut', 'colour-grading/'], ['liquify', 'liquify/'], ['relight', 'relight/'],
  ['product shadow', 'product-shadows/'], ['remove background', 'background-remover/'], ['invoice', 'invoice-maker/'], ['price list', 'catalogue-maker/'], ['wifi sign', 'qr-posters/'],
  ['sign pdf', 'pdf-editor/'], ['compare pdf', 'compare-pdfs/'], ['dark mode', 'themes/'], ['fonts', 'font-library/'], ['ai agent', 'agent-mode/'], ['screenshot', 'screenshot-beautifier/'],
  ['photo booth', 'photobooth-strip/'], ['embed design', 'embed-a-design/'], ['brand file', 'brand-file/'], ['design as code', 'design-as-code/'], ['expert look', 'batch-edit/'], ['calendar', 'studio/?make=calendar'], ['zine', 'studio/?make=zine'], ['photographers', 'photographers/'], ['sell online', 'sellers/'],
];

cases['site data: every live launch is one the tests can check (studio and PDF studio launches name a panel, maker or launchCheck)'] = async ({ h }) => {
  const bad = [];
  live.forEach((e) => {
    if (studioLaunch(e) && !(e.panel || e.maker || e.launchCheck)) bad.push(e.id + ' studio launch has no panel, maker or launchCheck');
    if (pdfLaunch(e) && !e.panel) bad.push(e.id + ' PDF studio launch has no panel');
    if (e.launchCheck && !['expert', 'agent', 'file', 'page', 'appearance'].includes(e.launchCheck)) bad.push(e.id + ' unknown launchCheck ' + e.launchCheck);
  });
  h.assert(!bad.length, bad.join(' | '));
};

cases['site data: Expert and agent-mode launches open Expert mode and the agent-mode explanation'] = async ({ browser, base, h }) => {
  const seen = new Set();
  for (const e of live.filter((x) => x.launchCheck === 'expert' || x.launchCheck === 'agent')) {
    if (seen.has(e.launch)) continue;
    seen.add(e.launch);
    const page = await h.open(browser, base, '/' + e.launch, 'desktop');
    if (e.launchCheck === 'expert') {
      await page.waitForFunction(() => !!document.querySelector('.is-expert'), null, { timeout: 20000 });
      h.assert(await page.evaluate(() => (document.title || '').indexOf('Photo studio') === 0), e.id + ': opens the photo studio');
    } else {
      await page.waitForFunction(() => /Agent\s*mode/i.test([...document.querySelectorAll('dialog[open], .le-dialog, .sx-modal')].map((d) => d.textContent).join(' ')), null, { timeout: 20000 });
    }
    h.assert.noErrors(page);
    await page.context().close();
  }
  h.assert(seen.size >= 2, 'both an Expert and an agent launch exist');
};

cases['site data: file, guide and page launches (docs, schema, llms.txt, fonts, licences, convert, recipes, storage) load without errors'] = async ({ browser, base, h }) => {
  const bad = [];
  const done = new Set();
  for (const e of live) {
    if (studioLaunch(e) || pdfLaunch(e) || done.has(e.launch)) continue;
    done.add(e.launch);
    if (e.launchCheck === 'file') {
      const res = await (await browser.newContext({ serviceWorkers: 'block' })).request.get(base + '/' + e.launch);
      if (res.status() !== 200 || !(await res.body()).length) bad.push(e.id + ': ' + e.launch + ' answers ' + res.status());
      continue;
    }
    const page = await h.open(browser, base, '/' + e.launch, 'desktop');
    const info = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main, [role=main]').length }));
    if (page.errors.length) bad.push(e.id + ': console ' + page.errors[0].slice(0, 80));
    if (info.h1 < 1 || info.main < 1) bad.push(e.id + ': ' + e.launch + ' has no h1 or main ' + JSON.stringify(info));
    await page.context().close();
  }
  h.assert(!bad.length, bad.join(' | '));
};

cases['site data: the Appearance button on the themes page opens the Appearance dialog'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/themes/', 'phone');
  await page.click('.pg-hero [data-appearance]');
  await page.waitForSelector('#le-appearance[open]', { timeout: 8000 });
  h.assert.equal(new URL(page.url()).pathname, '/themes/', 'the button does not navigate away');
  h.assert.noErrors(page);
};

cases['site data: titles are 75 characters or fewer and descriptions 70 to 170, on every generated page'] = async ({ h }) => {
  const bad = [];
  siteData.pages.forEach((e) => {
    const html = fs.readFileSync(path.join(ROOT, e.url, 'index.html'), 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/)[1].replace(/&amp;/g, '&');
    const desc = html.match(/<meta name="description" content="([^"]+)"/)[1];
    if (title.length > 75) bad.push(e.url + ' title ' + title.length);
    if (desc.length < 70 || desc.length > 170) bad.push(e.url + ' description ' + desc.length);
    if (/world-class|revolutionary|awwwards|best-in-class|cutting-edge/i.test(JSON.stringify(e))) bad.push(e.id + ' uses a hype word');
  });
  h.assert(!bad.length, bad.join(' | '));
};

cases['site data: no competitor or brand names in titles, copy or keywords'] = async ({ h }) => {
  const re = /\b(canva|photoshop|lightroom|figma|adobe|snapseed|picsart|capcut|ilovepdf|smallpdf|remove\.bg|polaroid|kodak|fujifilm film|google fonts)\b/i;
  const bad = siteData.entries.filter((e) => re.test(JSON.stringify(e).replace(/Fujifilm/g, ''))).map((e) => e.id);
  h.assert(!bad.length, 'brand names in: ' + bad.join(', '));
};

cases['site data: header search finds the new entries by the words a layperson would type'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/teachers/', 'desktop');
  const miss = [];
  await page.click('.le-top [data-search]');
  for (const [q, want] of SEARCH) {
    await page.fill('.le-dialog input', q);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('.le-dialog ul a')].map((a) => a.getAttribute('href')));
    if (!hrefs.some((x) => x.endsWith(want))) miss.push('"' + q + '" does not find ' + want);
  }
  h.assert(!miss.length, miss.join(' | '));
  h.assert.noErrors(page);
};

cases['site data: hubs lead with 6 to 12 entries and every hub has a promise and a privacy line'] = async ({ h }) => {
  const bad = [];
  siteData.hubs.filter((e) => !e.directory).forEach((e) => {
    const first = siteData.items(e.sections[0].items).length;
    if (first < 3 || first > 12) bad.push(e.id + ' first section has ' + first);
    if (!e.summary || !e.privacy) bad.push(e.id + ' lacks a summary or privacy line');
  });
  ['expert', 'photographers', 'sellers', 'ai-agents', 'social', 'business', 'office', 'teachers', 'privacy-tools', 'photo', 'pdf', 'tools'].forEach((id) => h.assert(siteData.hubs.some((e) => e.id === id), 'hub missing: ' + id));
  h.assert(!bad.length, bad.join(' | '));
};
module.exports = cases;
