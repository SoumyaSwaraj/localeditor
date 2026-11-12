'use strict';
/* Every page of the site (all tool pages) loads with an empty console and without sideways scroll at phone size; desktop is checked for console errors. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dirs = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.html')) && !/^(studio|pdf-studio|convert-to-pdf|recipes|node_modules)$/.test(d)).sort();
const cases = {};

cases['all ' + dirs.length + ' tool and info pages: phone 390x844 has no console errors and no sideways scroll'] = async ({ browser, base, h }) => {
  const bad = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  for (const d of dirs) {
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
cases['all tool and info pages: desktop 1440x900 has no console errors, a title, one h1 and a main landmark'] = async ({ browser, base, h }) => {
  const bad = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  for (const d of dirs) {
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
module.exports = cases;
