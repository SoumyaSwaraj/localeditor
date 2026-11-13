'use strict';
/* Category hubs and feature pages (scripts/build-pages.js, assets/data/site.json).
   Every generated page: clean console, no sideways scroll, one h1, unique title and description, valid JSON-LD,
   every internal link resolves, launch links open the right studio panel, and nothing marked "soon" leaks out. */
const fs = require('fs');
const path = require('path');
const pages = require('../scripts/build-pages');
const build = require('../scripts/build');

const ROOT = path.resolve(__dirname, '..');
const site = pages.load();
const read = (url) => fs.readFileSync(path.join(ROOT, url, 'index.html'), 'utf8');
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const soon = site.entries.filter((e) => !site.visible(e));
/* Tools that really exist (scripts/build.js TOOLS writes their pages and lists them on tools/ and in search).
   A data entry still marked soon for one of them is a data mismatch, not an unreleased feature leaking out. */
const builtTools = new Set(build.TOOLS.map((t) => t.slug + '/'));
const isBuiltTool = (e) => builtTools.has(e.launch) || builtTools.has(e.url);
const unreleased = soon.filter((e) => !isBuiltTool(e));
const cases = {};

cases['the generator is idempotent and only live or beta entries get a page'] = async ({ h }) => {
  const first = pages.build({ quiet: true });
  h.assert.equal(first.changed.length, 0, 'Committed pages are out of date; run node scripts/build-pages.js. Changed: ' + first.changed.join(', '));
  const second = pages.build({ quiet: true });
  h.assert.equal(second.changed.length, 0, 'A second run changed files: ' + second.changed.join(', '));
  h.assert(site.hubs.length >= 8, 'Eight hubs, got ' + site.hubs.length);
  site.pages.forEach((e) => h.assert(read(e.url).includes(pages.MARK), e.url + ' was not written by the generator'));
  soon.filter((e) => e.url).forEach((e) => {
    const f = path.join(ROOT, e.url, 'index.html');
    h.assert(!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(pages.MARK), 'A page was generated for a soon entry: ' + e.url);
  });
  ['photo-privacy/', 'device-check/'].forEach((u) => {
    const f = path.join(ROOT, u, 'index.html');
    h.assert(!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(pages.MARK), 'Generated a page over another engineer\'s tool: ' + u);
  });
};

cases['no soon feature is mentioned on a generated page, the homepage or in search'] = async ({ h }) => {
  const app = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
  const index = app.slice(app.indexOf('/* BEGIN site index */'), app.indexOf('/* END site index */'));
  const docs = site.pages.map((e) => [e.url, read(e.url)]).concat([['index.html', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')]]);
  for (const [url, html] of docs) {
    const head = (html.match(/<title>([^<]*)/) || [])[1] + ' ' + (html.match(/name="description" content="([^"]*)/) || [])[1];
    const text = (textOf(html) + ' ' + head).toLowerCase();
    unreleased.forEach((e) => {
      h.assert(!text.includes(e.title.toLowerCase()), url + ' mentions the soon entry "' + e.title + '"');
      if (e.url) h.assert(!html.includes('href="' + e.url + '"') && !html.includes('href="../' + e.url + '"'), url + ' links to soon ' + e.url);
    });
  }
  unreleased.forEach((e) => h.assert(!index.includes('"' + e.title + '"'), 'Search index lists soon entry ' + e.title));
};

/* Data consistency: a tool that is built by scripts/build.js (TOOLS) must not be soon in the data (photo-privacy was, until the
   site-data pass flipped it). */
cases['a tool that is live in scripts/build.js is not marked soon in site.json'] = async ({ h }) => {
  const stale = soon.filter(isBuiltTool).map((e) => e.id);
  h.assert.equal(stale.length, 0, 'live tools still marked soon: ' + stale.join(', '));
};

cases['every live feature, tool page and hub is registered: llms.txt, header search, homepage, tools hub; no soon feature anywhere'] = async ({ h }) => {
  const llms = fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
  const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tools = read('tools');
  const index = app.slice(app.indexOf('/* BEGIN site index */'), app.indexOf('/* END site index */'));
  ['photo-privacy/', 'device-check/'].forEach((u) => {
    h.assert(llms.includes('https://localeditor.net/' + u), 'llms.txt lists ' + u);
    h.assert(app.includes("'" + u + "'"), 'header search tools list has ' + u);
    h.assert(home.includes('href="' + u + '"'), 'homepage directory links ' + u);
    h.assert(tools.includes('href="../' + u + '"'), 'tools hub lists ' + u);
  });
  site.features.concat(site.hubs).forEach((e) => {
    h.assert(llms.includes('https://localeditor.net/' + e.url), 'llms.txt lists ' + e.url);
    if (e.kind === 'feature') h.assert(index.includes('"' + e.url + '"'), 'search index has ' + e.url);
  });
  const dir = home.match(/id="dir-dev">Utilities <span>(\d+)<\/span>/);
  h.assert(dir && Number(dir[1]) === build.TOOLS.filter((t) => t.cat === 'dev').length, 'homepage Utilities count matches the tool list');
  const img = home.match(/id="dir-image">Image <span>(\d+)<\/span>/);
  h.assert(img && Number(img[1]) === build.TOOLS.filter((t) => t.cat === 'image').length, 'homepage Image count matches the tool list');
  const n = (llms.match(/ (?:plus|and) (\d+) browser tools/) || [])[1];
  h.assert.equal(Number(n), build.TOOLS.length, 'llms.txt tool count');
  soon.forEach((e) => h.assert(!llms.includes(e.title) && !(e.url && llms.includes(e.url)) && !(e.url && index.includes('"' + e.url + '"')), 'a soon entry leaked into llms.txt or search: ' + e.title));
  const bad = [];
  for (const m of llms.matchAll(/\(https:\/\/localeditor\.net\/([^)]*)\)/g)) {
    const p = m[1] || '';
    if (!p || p === 'sitemap.xml') continue;
    if (!fs.existsSync(path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p))) bad.push(p);
  }
  h.assert(!bad.length, 'llms.txt links that do not resolve: ' + bad.join(', '));
};

cases['each page has one h1, a unique title and description, and valid JSON-LD'] = async ({ h }) => {
  const titles = new Set(), descs = new Set();
  for (const e of site.pages) {
    const html = read(e.url);
    h.assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, e.url + ' h1 count');
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const desc = html.match(/<meta name="description" content="([^"]+)"/)[1];
    h.assert(!titles.has(title), 'Duplicate title ' + title);
    h.assert(!descs.has(desc), 'Duplicate description on ' + e.url);
    titles.add(title); descs.add(desc);
    h.assert(html.includes('<link rel="canonical" href="https://localeditor.net/' + e.url + '">'), e.url + ' canonical');
    h.assert(html.includes('property="og:title"') && html.includes('property="og:image"'), e.url + ' Open Graph');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    h.assert(blocks.length === 1, e.url + ' has one JSON-LD block');
    const types = blocks[0]['@graph'].map((g) => g['@type']);
    h.assert(types.includes('BreadcrumbList') && types.includes('FAQPage'), e.url + ' JSON-LD types: ' + types);
    if (e.kind === 'feature') h.assert(types.includes('SoftwareApplication'), e.url + ' SoftwareApplication');
    const faq = blocks[0]['@graph'].find((g) => g['@type'] === 'FAQPage');
    h.assert(faq.mainEntity.length === e.faq.length, e.url + ' FAQ entries');
  }
};

cases['every internal link on every generated page resolves'] = async ({ h }) => {
  const bad = [];
  for (const e of site.pages) {
    const html = read(e.url);
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const raw = m[1];
      if (/^(https?:|mailto:|data:|#)/.test(raw)) continue;
      const u = new URL(raw, 'http://x/' + e.url);
      let p = decodeURIComponent(u.pathname).slice(1);
      if (p === '' || p.endsWith('/')) p += 'index.html';
      if (!fs.existsSync(path.join(ROOT, p))) bad.push(e.url + ' -> ' + raw);
    }
  }
  h.assert(!bad.length, 'Broken links: ' + bad.slice(0, 8).join(', '));
};

cases['launch links exist; feature pages stay out of the precache, hubs stay in'] = async ({ h }) => {
  site.entries.filter(site.visible).filter((e) => e.launch).forEach((e) => {
    const p = e.launch.split(/[?#]/)[0];
    h.assert(fs.existsSync(path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p)), e.id + ' launch missing: ' + e.launch);
  });
  const list = build.precacheList();
  site.hubs.forEach((e) => h.assert(list.includes('./' + e.url), 'hub not precached: ' + e.url));
  site.features.forEach((e) => h.assert(!list.includes('./' + e.url), 'feature page precached: ' + e.url));
  h.assert(list.includes('./assets/css/pages.css'), 'pages.css precached');
  h.assert(!list.includes('./assets/data/site.json'), 'site.json is build input only');
};

/* Studio launches: the URL opens the intended panel (and app or tab). */
const launches = new Map();
site.entries.filter(site.visible).filter((e) => e.panel && /^studio\//.test(e.launch)).forEach((e) => launches.set(e.launch, e));
for (const [url, e] of launches) {
  cases['launch ' + url + ' opens ' + e.panel + (e.panelOpts ? ' ' + JSON.stringify(e.panelOpts) : '')] = async ({ browser, base, h }) => {
    const page = await h.open(browser, base, '/' + url, 'desktop');
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.S && window.LEStudio.S.panel, null, { timeout: 15000 });
    const got = await page.evaluate(() => ({ panel: window.LEStudio.S.panel, opts: window.LEStudio.S.panelOpts || {} }));
    h.assert.equal(got.panel, e.panel, url + ' panel');
    Object.keys(e.panelOpts || {}).forEach((k) => h.assert.equal(got.opts[k], e.panelOpts[k], url + ' ' + k));
    h.assert.noErrors(page);
  };
}

/* Quick makers open their form: /studio/?make=<id>. */
site.entries.filter(site.visible).filter((e) => e.maker).forEach((e) => {
  cases['launch ' + e.launch + ' opens the ' + e.maker + ' maker form'] = async ({ browser, base, h }) => {
    h.assert.equal(e.launch, 'studio/?make=' + e.maker, e.id + ' launch matches its maker');
    const page = await h.open(browser, base, '/' + e.launch, 'desktop');
    await page.waitForFunction(() => window.LEStudioMakers && window.LEStudioMakers.form(), null, { timeout: 15000 });
    h.assert.equal(await page.evaluate(() => window.LEStudioMakers.form().m.id), e.maker, e.launch + ' maker');
    h.assert(await page.isVisible('.mk-make'), e.launch + ' shows the Make it button');
    h.assert.noErrors(page);
  };
});

/* PDF studio launches: ?panel=<id>&job=<job>. The URL, the entry's panel and job agree, and the panel (and job) opens.
   Panels that need a document wait for a file: the open-file prompt stays, and choosing a file continues to the panel. */
const SEC_VIEW = { send: 'send', reveal: 'reveal', safety: 'safety', redact: 'redact', find: 'redact' };
const pdfLaunches = new Map();
site.entries.filter(site.visible).filter((e) => e.panel && /^pdf-studio\//.test(e.launch)).forEach((e) => pdfLaunches.set(e.launch, e));
for (const [url, e] of pdfLaunches) {
  cases['launch ' + url + ' opens ' + e.panel + ' ' + e.job] = async ({ browser, base, h }) => {
    const q = new URL('http://x/' + url).searchParams;
    h.assert.equal(q.get('panel'), e.panel, url + ' panel in the URL');
    h.assert.equal(q.get('job') || null, e.job || null, url + ' job in the URL');
    const page = await h.open(browser, base, '/' + url, 'desktop');
    await page.waitForFunction(() => window.PS && document.body.classList.contains('ps-ready'), null, { timeout: 15000 });
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    const noDoc = await page.evaluate((p) => !!PS.panels[p].noDoc, e.panel);
    if (!noDoc) {
      const wait = await page.evaluate(() => ({ panel: PS.S.panel, pending: PS.pendingPanel, pages: PS.S.pages.length }));
      h.assert.equal(wait.panel, '', url + ' waits for a file');
      h.assert.equal(wait.pending, e.panel, url + ' remembers the panel');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="intent"][data-intent="merge"]')]);
      await chooser.setFiles(path.join(ROOT, 'tests/fixtures/pdf-bulk/payslips-30.pdf'));
      await page.waitForFunction((p) => PS.S.panel === p, e.panel, { timeout: 20000 });
    } else {
      await page.waitForFunction((p) => PS.S.panel === p, e.panel, { timeout: 10000 });
    }
    if (e.panel === 'security') {
      h.assert.equal(await page.evaluate(() => PS.security.view), SEC_VIEW[e.job], url + ' security view');
      if (e.job === 'find') h.assert.equal(await page.evaluate(() => !!PS.security.findOpen), true, url + ' find box open');
    } else if (e.panel === 'bulk') {
      await page.waitForSelector('.pb-work:not([hidden])[data-job="' + e.job + '"]', { timeout: 10000 });
    } else if (e.panel === 'office') {
      await page.waitForSelector('.po-work:not([hidden])[data-job="' + e.job + '"]', { timeout: 10000 });
    }
    h.assert.noErrors(page);
  };
}

/* Every page at every size and theme. */
site.pages.forEach((e) => {
  cases['/' + e.url + ' renders cleanly at desktop, phone and small in both themes'] = async ({ browser, base, h }) => {
    for (const vp of ['desktop', 'phone', 'small']) {
      for (const theme of ['light', 'dark']) {
        const page = await h.open(browser, base, '/' + e.url, vp, { colorScheme: theme });
        h.assert.noErrors(page);
        h.assert(await h.noOverflow(page), e.url + ' scrolls sideways at ' + vp + ' ' + theme);
        const info = await page.evaluate(() => ({
          small: [...document.querySelectorAll('.pg-row-go, .pg-row-main, .pg-hub, .hp-tool')].filter((a) => a.offsetParent && a.getBoundingClientRect().height < 44).length,
        }));
        (await h.inkContrast(page, 'main .btn-primary, main .btn-gold')).forEach((c) => h.assert(c.ratio >= 4.5, e.url + ' primary text ' + c.color + ' on ' + c.bg + ' is ' + c.ratio + ':1'));
        if (vp !== 'desktop') h.assert.equal(info.small, 0, e.url + ' has touch targets under 44px');
        await page.context().close();
      }
    }
  };
});

cases['homepage links to every hub; drawer and footer list them'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/', 'small');
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('.pg-hubs a')].map((a) => a.getAttribute('href')));
  site.hubs.forEach((e) => h.assert(hrefs.includes(e.url), 'Homepage misses hub ' + e.url));
  const foot = await page.evaluate(() => [...document.querySelectorAll('.pg-foot-hubs a')].map((a) => a.getAttribute('href')));
  h.assert.equal(foot.length, site.hubs.length, 'Footer hub links');
  await page.click('.le-top [data-menu]');
  await page.waitForTimeout(400);
  for (const e of site.hubs) h.assert(await page.isVisible('.le-side a[href="' + e.url + '"]'), 'Drawer misses ' + e.url);
  h.assert.noErrors(page);
};

cases['header search finds a hub and a feature page'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/teachers/', 'desktop');
  await page.click('.le-top [data-search]');
  await page.keyboard.type('teach');
  h.assert(await page.isVisible('.le-dialog a[href="../teachers/"]'), 'Search finds the teachers hub');
  await page.fill('.le-dialog input', 'collage maker');
  h.assert(await page.isVisible('.le-dialog a[href="../collage-maker/"]'), 'Search finds the collage maker page');
  await page.fill('.le-dialog input', 'confidential');
  h.assert(await page.isVisible('.le-dialog a[href="../office/"]'), 'Search finds the office hub by its tagline');
  h.assert.noErrors(page);
};

cases['every-tool hub filters like the homepage directory'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/tools/', 'phone');
  const visible = () => page.evaluate(() => [...document.querySelectorAll('[data-tool-dir] .hp-tool')].filter((a) => a.offsetParent !== null).length);
  const all = await visible();
  h.assert(all >= build.TOOLS.length, 'Every tool listed, got ' + all);
  await page.fill('[data-dir-search]', 'merge');
  h.assert((await visible()) < all, 'Search narrows the list');
  await page.fill('[data-dir-search]', '');
  await page.click('[data-dir-cat="pdf"]');
  h.assert.equal(await visible(), build.TOOLS.filter((t) => t.cat === 'pdf').length, 'PDF chip');
  h.assert.noErrors(page);
};

cases['install and storage launches open their dialogs in place'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/storage-manager/', 'phone');
  const btn = page.locator('.pg-hero .btn-gold');
  h.assert.equal(await btn.getAttribute('data-le-storage'), '', 'Storage launch is wired to the storage manager');
  const page2 = await h.open(browser, base, '/install/', 'phone');
  h.assert.equal(await page2.locator('.pg-hero .btn-gold').getAttribute('data-le-install'), '', 'Install launch is wired to install');
  h.assert.noErrors(page);
  h.assert.noErrors(page2);
};

module.exports = cases;
