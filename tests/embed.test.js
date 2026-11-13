'use strict';
/* The embed viewer (embed/index.html, assets/js/le-embed.js, docs/EMBED.md): a read-only view of a template link or a
   same-origin design file, with page navigation and an "Open in the studio to edit" button. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const EX = (name) => fs.readFileSync(path.join(ROOT, 'examples', 'designs', name + '.ledesign.json'), 'utf8');
const cases = {};

/* A template-link payload for a design text, made by the studio's own writer. */
async function payloadFor(browser, base, h, text) {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.lazy);
  await h.need(page, 'design');
  const r = await page.evaluate(async (t) => { const res = await LE.design.parse(t); const l = await LE.design.toLink(res.project); return { payload: l.payload, name: res.project.name, pages: res.project.pages.length }; }, text);
  await page.close();
  return r;
}
const lum = (rgb) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(rgb); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : -1; };
async function shown(target) { await target.waitForSelector('canvas.em-page', { timeout: 30000 }); await target.waitForFunction(() => document.getElementById('em').getAttribute('aria-busy') === 'false'); }
const colours = (target) => target.evaluate(() => { const c = document.querySelector('canvas.em-page'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return s.size; });

cases['a template link is drawn page by page; buttons and keys turn pages; the studio button carries the same link; this origin only'] = async ({ browser, base, h }) => {
  const link = await payloadFor(browser, base, h, EX('tips-carousel'));
  h.assert(link.pages >= 3, 'the example has several pages');
  const page = await h.open(browser, base, '/offline.html', 'desktop');
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto(base + '/embed/#d=' + link.payload);
  await shown(page);
  h.assert.equal(await page.textContent('#em-title'), link.name);
  h.assert.equal(await page.textContent('#em-status'), 'Page 1 of ' + link.pages);
  h.assert(await colours(page) >= 3, 'the page is drawn, not blank');
  h.assert(await page.isDisabled('#em-prev') && !(await page.isDisabled('#em-next')), 'previous is off on the first page');
  const label = await page.getAttribute('canvas.em-page', 'aria-label');
  h.assert(label.startsWith(link.name + ', page 1 of ' + link.pages) && label.length > link.name.length + 20, 'the picture has a text alternative with the page text: ' + label);
  await page.click('#em-next');
  await page.waitForFunction((n) => document.getElementById('em-status').textContent === 'Page 2 of ' + n, link.pages);
  await shown(page);
  await page.focus('#em-stage');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((n) => document.getElementById('em-status').textContent === 'Page 3 of ' + n, link.pages);
  await page.keyboard.press('End');
  await page.waitForFunction((n) => document.getElementById('em-status').textContent === 'Page ' + n + ' of ' + n, link.pages);
  h.assert(await page.isDisabled('#em-next'), 'next is off on the last page');
  await page.keyboard.press('Home');
  await page.waitForFunction(() => /^Page 1 of/.test(document.getElementById('em-status').textContent));
  await shown(page);
  h.assert.equal(await page.getAttribute('#em-open', 'href'), base + '/studio/#d=' + link.payload);
  h.assert(await page.isVisible('#em-open') && /Open in the studio to edit/.test(await page.textContent('#em-open')), 'the studio button shows');
  h.assert.equal(await page.getAttribute('#em-open', 'rel'), 'noopener');
  const box = await page.evaluate(() => { const s = document.getElementById('em-stage').getBoundingClientRect(), c = document.querySelector('canvas.em-page').getBoundingClientRect(); return { in: c.left >= s.left - 1 && c.right <= s.right + 1 && c.top >= s.top - 1 && c.bottom <= s.bottom + 1, w: c.width, h: c.height, target: document.getElementById('em-next').getBoundingClientRect().height }; });
  h.assert(box.in && box.w > 100 && box.h > 100, 'the page fits inside the viewer: ' + JSON.stringify(box));
  h.assert(box.target >= 44, 'page buttons are 44 px targets');
  const away = urls.filter((u) => !u.startsWith(base) && !/^(data|blob|about):/.test(u));
  h.assert(!away.length, 'no request leaves this origin: ' + away.join(', '));
  h.assert(!urls.some((u) => /le-studio|le-pdf|vendor\//.test(u)), 'the studio shell is not loaded');
  h.assert.noErrors(page);
};

cases['a design file on this site by ?src; other origins, missing files, unsafe files and no design are plain messages'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/embed/?src=../examples/designs/hello-world.ledesign.json&theme=dark', 'small');
  await shown(page);
  h.assert(await colours(page) >= 2, 'drawn');
  h.assert(await page.isHidden('#em-nav'), 'one page: no page buttons');
  await page.waitForFunction(() => !document.getElementById('em-open').hidden);
  h.assert(/\/studio\/#d=[A-Za-z0-9_-]+$/.test(await page.getAttribute('#em-open', 'href')), 'a file gets a studio link made from it');
  await h.noOverflow(page);
  h.assert(lum(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) < 0.25, 'theme=dark uses the dark tokens');
  h.assert.noErrors(page);
  await page.goto(base + '/embed/?src=../examples/designs/hello-world.ledesign.json&theme=light');
  await shown(page);
  await page.waitForFunction(() => document.getElementById('em').classList.contains('is-styled'));
  h.assert(lum(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) > 0.8, 'theme=light uses the light tokens');

  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  const message = async (url) => { await page.goto(base + url); await page.waitForFunction(() => document.getElementById('em').getAttribute('aria-busy') === 'false'); return page.textContent('#em-msg'); };
  h.assert(/from this site only/.test(await message('/embed/?src=https://example.com/a.ledesign.json')), 'another origin is refused');
  h.assert(/from this site only/.test(await message('/embed/?src=//example.com/a.json')), 'a protocol-relative address is refused');
  h.assert(/from this site only/.test(await message('/embed/?src=../assets/js/app.js')), 'only .json paths');
  h.assert(!urls.some((u) => !u.startsWith(base) && /example\.com/.test(u)), 'nothing was requested from the other origin');
  h.assert(/not found/.test(await message('/embed/?src=../examples/designs/nope.ledesign.json')), 'a missing file says so');
  h.assert(/no design to show/.test(await message('/embed/')), 'no design: a plain message');
  h.assert(/cannot be shown/.test(await message('/embed/#d=j' + Buffer.from(JSON.stringify({ format: 'localeditor-design', version: 1, name: 'x', pages: [{ width: 100, height: 100, layers: [{ type: 'text', text: '<img src=x onerror=window.__ran=1>' }] }] })).toString('base64url'))), 'markup in a design is refused');
  h.assert(/cannot be shown/.test(await message('/embed/#d=zAAAA')), 'a damaged link says so');
  h.assert(!(await page.evaluate(() => window.__ran)) && (await page.evaluate(() => document.querySelectorAll('#em img, #em script').length)) === 0, 'nothing from the document ran or became markup');
  h.assert(await page.isHidden('#em-open'), 'no studio button without a design');
};

cases['inside a sandboxed frame on another page: fits the frame, pages turn, a blocked new tab becomes a link to copy'] = async ({ browser, base, h }) => {
  const link = await payloadFor(browser, base, h, EX('tips-carousel'));
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    /* The host page is another origin: the same server by its other name (a loopback page may frame a loopback page). */
    const host = base.replace('127.0.0.1', 'localhost');
    h.assert(host !== base, 'the test server is on 127.0.0.1');
    await page.goto(host + '/offline.html');
    await page.evaluate((src) => {
      const f = document.createElement('iframe');
      f.id = 'f'; f.title = 'Design'; f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); f.style.cssText = 'width:420px;height:320px;border:0;position:fixed;left:0;top:0';
      f.src = src;
      document.body.appendChild(f);
    }, base + '/embed/#d=' + link.payload);
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    h.assert(frame, 'the viewer loads in the frame');
    await shown(frame);
    const m = await frame.evaluate(() => { const c = document.querySelector('canvas.em-page').getBoundingClientRect(); return { w: innerWidth, h: innerHeight, cw: c.width, ch: c.height, right: c.right, bottom: c.bottom, over: document.documentElement.scrollWidth - innerWidth, bar: document.getElementById('em-bar').getBoundingClientRect().bottom }; });
    h.assert(m.w === 420 && m.h === 320 && m.right <= 420 && m.bottom <= 320 && m.cw > 60 && m.over <= 1 && m.bar <= 321, 'fits a 420 × 320 frame: ' + JSON.stringify(m));
    await frame.click('#em-next');
    await frame.waitForFunction(() => /^Page 2 of/.test(document.getElementById('em-status').textContent));
    await frame.click('#em-open');
    await frame.waitForSelector('#em-copy:not([hidden])');
    h.assert.equal(await frame.inputValue('#em-link'), base + '/studio/#d=' + link.payload, 'the address is offered for copying');
    h.assert.equal(ctx.pages().length, 1, 'no tab was opened from the sandbox');
    h.assert(!errors.length, 'no script errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
};

cases['the Share sheet copies an embed code that points at the viewer'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'small');
  await h.need(page, 'design');
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } }); LE.design.openShare(window.LEStudio); });
  await page.waitForSelector('.sxd-share [data-embed]:not([disabled])');
  await page.click('.sxd-share [data-embed]');
  await page.waitForFunction(() => window.__copied.length === 1);
  const code = await page.evaluate(() => window.__copied[0]);
  h.assert(/^<iframe src="[^"]+\/embed\/#d=[A-Za-z0-9_-]+" title="[^"<>]*" width="480" height="\d+" style="border:0;max-width:100%" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"><\/iframe>$/.test(code), code.slice(0, 200));
  h.assert(await h.noOverflow(page), 'the sheet still fits 360 px');
  const src = /src="([^"]+)"/.exec(code)[1];
  const view = await h.open(browser, base, src.replace(/^https?:\/\/[^/]+/, ''), 'desktop');
  await shown(view);
  h.assert.noErrors(view);
};

cases['what blocks the first paint is small: the page, one style sheet and one script under 8 KB gzip'] = async ({ h }) => {
  const html = fs.readFileSync(path.join(ROOT, 'embed', 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).concat([...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]));
  h.assert.equal(tags.sort().join(','), '../assets/css/embed.css,../assets/js/le-embed.js');
  h.assert(!/<script(?![^>]*\bsrc=)/.test(html) && !/\son[a-z]+=/.test(html) && !/https?:\/\/(?!localeditor\.net)/.test(html), 'no inline script, no inline handlers, no other host');
  const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length;
  const total = gz(path.join(ROOT, 'embed', 'index.html')) + gz(path.join(ROOT, 'assets', 'css', 'embed.css')) + gz(path.join(ROOT, 'assets', 'js', 'le-embed.js'));
  h.assert(total < 8 * 1024, 'blocking weight is ' + (total / 1024).toFixed(1) + ' KB gzip');
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'embed.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  h.assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'the style sheet holds no colour of its own');
};

module.exports = cases;
