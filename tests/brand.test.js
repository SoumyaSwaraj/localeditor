'use strict';
/* Identity and design tokens (docs/DESIGN.md, docs/research/interface-psychology.md):
   - every semantic text/background token pair meets WCAG AA (4.5:1) in both themes, read from the stylesheet;
   - the primary action's computed text meets 4.5:1 on home, studio and PDF studio in both themes;
   - focus is visible (3:1) on the shared interactive components;
   - no retired gold / foil / amethyst literals in CSS or inline styles (aliases in app.css are tokens, not literals);
   - editor chrome is neutral (no hue cast) in the studio and the PDF studio, and the canvas surround setting works;
   - manifest colours and icon files match the identity;
   - no console errors and no sideways scroll on the main surfaces. */
const fs = require('fs');
const path = require('path');
const cases = {};

const ROOT = path.resolve(__dirname, '..');
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const rgbOf = (c) => {
  c = String(c).trim();
  if (c[0] === '#') { let x = c.slice(1); if (x.length === 3) x = x.split('').map((y) => y + y).join(''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); }
  const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null;
};
const lum = (c) => { const r = rgbOf(c); return 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* OKLCH chroma of an sRGB colour (0 for a true grey). */
const chroma = (c) => {
  const [r, g, b] = rgbOf(c).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return Math.hypot(A, B);
};

const SKINS = ['clear', 'lapis', 'graphite', 'paper', 'contrast'];
const TEXT = ['--ink', '--muted', '--faint', '--accent', '--ok', '--private', '--warn', '--err', '--warm-ink'];
const BACK = ['--bg', '--bg-2', '--surface', '--surface-2'];
const PAIRS = [['--on-primary', '--primary'], ['--on-primary', '--primary-hover'], ['--on-primary', '--primary-active'], ['--accent', '--selected-bg'], ['--ink', '--selected-bg'],
  ['--private', '--private-soft'], ['--ok', '--add-bg'], ['--warn', '--warn-soft'], ['--err', '--err-soft'], ['--err', '--del-bg'], ['--warm-ink', '--warm-soft'],
  ['--side-text', '--side'], ['--side-dim', '--side'], ['--side-text', '--side-2'], ['--side-dim', '--side-2'], ['--stage-ink', '--stage']];

['light', 'dark'].forEach((theme) => {
  cases[theme + ': every theme: each semantic text/background token pair meets AA (4.5:1), rings 3:1, targets 44 px'] = async ({ browser, base, h }) => {
    const page = await h.openTheme(browser, base, '/', 'desktop', theme);
    const names = [...new Set(TEXT.concat(BACK, [].concat(...PAIRS), ['--focus-ring', '--primary-edge', '--side-accent', '--target']))];
    const bad = [];
    for (const skin of SKINS) {
      const v = await page.evaluate(([n, k]) => { const r = document.documentElement; if (k === 'clear') r.removeAttribute('data-skin'); else r.setAttribute('data-skin', k); const cs = getComputedStyle(r); const o = {}; n.forEach((x) => { o[x] = cs.getPropertyValue(x).trim(); }); return o; }, [names, skin]);
      const p = skin + ' ';
      TEXT.forEach((t) => BACK.forEach((b) => { const r = ratio(v[t], v[b]); if (r < 4.5) bad.push(p + t + ' on ' + b + ' ' + r.toFixed(2)); }));
      PAIRS.forEach(([t, b]) => { const r = ratio(v[t], v[b]); if (r < 4.5) bad.push(p + t + ' on ' + b + ' ' + r.toFixed(2)); });
      BACK.forEach((b) => { const r = ratio(v['--focus-ring'], v[b]); if (r < 3) bad.push(p + '--focus-ring on ' + b + ' ' + r.toFixed(2)); });
      BACK.forEach((b) => { const r = ratio(v['--primary-edge'], v[b]); if (r < 3) bad.push(p + '--primary-edge on ' + b + ' ' + r.toFixed(2)); });
      if (ratio(v['--side-accent'], v['--side']) < 3) bad.push(p + '--side-accent on --side ' + ratio(v['--side-accent'], v['--side']).toFixed(2));
      if (!(parseFloat(v['--target']) >= 44)) bad.push(p + '--target ' + v['--target']);
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-skin'));
    h.assert(bad.length === 0, 'pairs under the minimum: ' + bad.join('; '));
    /* The three canvas surrounds keep their own text readable. */
    for (const s of ['light', 'mid', 'dark']) {
      const r = await page.evaluate((x) => { document.documentElement.setAttribute('data-surround', x); const cs = getComputedStyle(document.documentElement); return [cs.getPropertyValue('--stage-ink').trim(), cs.getPropertyValue('--stage').trim()]; }, s);
      h.assert(ratio(r[0], r[1]) >= 4.5, 'surround ' + s + ': ' + r.join(' on '));
    }
  };

  cases[theme + ': the primary action text meets 4.5:1 on home, studio and PDF studio'] = async ({ browser, base, h }) => {
    const check = async (page, where) => {
      const list = await h.inkContrast(page, '.btn-primary:not(:disabled), .btn-gold:not(:disabled)');
      h.assert(list.length >= 1, where + ': a primary button is visible');
      list.forEach((c) => h.assert(c.ratio >= 4.5, where + ': "' + c.text + '" ' + c.color + ' on ' + c.bg + ' is ' + c.ratio + ':1'));
    };
    let page = await h.openTheme(browser, base, '/', 'desktop', theme);
    await check(page, 'home');
    await page.context().close();
    page = await h.openTheme(browser, base, '/studio/', 'desktop', theme);
    await page.waitForSelector('.sx-size-card');
    await check(page, 'studio start');
    await page.evaluate(() => window.LEStudio.useSample());
    await page.waitForTimeout(400);
    await check(page, 'studio header');
    await page.context().close();
    page = await h.openTheme(browser, base, '/pdf-studio/', 'desktop', theme);
    await page.click('text=Blank PDF');
    await page.waitForFunction(() => document.body.classList.contains('ps-has-doc'));
    await page.waitForTimeout(300);
    await check(page, 'PDF studio');
    h.assert.noErrors(page);
  };

  cases[theme + ': editor chrome is neutral (no hue cast) in the studio and the PDF studio'] = async ({ browser, base, h }) => {
    const chromeOf = (page, sels) => page.evaluate((s) => s.map((q) => { const e = document.querySelector(q); return [q, e ? getComputedStyle(e).backgroundColor : null]; }), sels);
    const assertNeutral = (list, where) => list.forEach(([q, c]) => {
      if (!c || /rgba\(.*, 0\)$/.test(c)) return;
      h.assert(chroma(c) < 0.006, where + ' ' + q + ' has a hue cast: ' + c + ' (chroma ' + chroma(c).toFixed(4) + ')');
    });
    const page = await h.openTheme(browser, base, '/studio/', 'desktop', theme);
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
    await page.evaluate(() => window.LEStudio.useSample());
    await h.openPanel(page, 'adjust');
    assertNeutral(await chromeOf(page, ['body', '.sx-head', '.sx-rail', '.sx-panel', '.sx-stage', '.sx-scene', '.sx-tool', '.sx-foot']), 'studio');
    /* Canvas surround setting: one hook, three neutral greys. */
    const greys = [];
    for (const s of ['light', 'mid', 'dark']) {
      await page.evaluate((x) => window.LE.surround.set(x), s);
      const c = await page.evaluate(() => getComputedStyle(document.querySelector('.sx-scene')).backgroundColor);
      h.assert(chroma(c) < 0.006, 'surround ' + s + ' is not neutral: ' + c);
      greys.push(lum(c));
    }
    h.assert(/rgba\(0, ?0, ?0, ?0\)|transparent/.test(await page.evaluate(() => window.LEStudio.scene._workspace)), 'the scene canvas paints no surround of its own (the CSS surround shows)');
    h.assert(greys[0] > greys[1] && greys[1] > greys[2], 'light > mid > dark surround: ' + greys.map((x) => x.toFixed(3)).join(', '));
    await page.evaluate(() => window.LE.surround.set('auto'));
    await h.openPanel(page, 'settings');
    h.assert(await page.$('#sx-panel-body .sx-seg, #sx-panel-body .seg') !== null, 'settings show the surround control');
    h.assert(/Canvas surround/.test(await page.textContent('#sx-panel-body')), 'settings name the canvas surround');
    await page.context().close();
    const pdf = await h.openTheme(browser, base, '/pdf-studio/', 'desktop', theme);
    await pdf.click('text=Blank PDF');
    await pdf.waitForFunction(() => document.body.classList.contains('ps-has-doc'));
    await pdf.waitForTimeout(300);
    assertNeutral(await chromeOf(pdf, ['body', '.ps-top', '.ps-rail', '.ps-stage', '.ps-status', '.ps-panel', '.ps-thumbs']), 'PDF studio');
  };
});

cases['Expert: neutral chrome, mid-grey surround by default, Lapis only for "on"'] = async ({ browser, base, h }) => {
  for (const theme of ['light', 'dark']) {
    const page = await h.openTheme(browser, base, '/studio/', 'desktop', theme);
    await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
    await page.evaluate(async () => { const r = await fetch('/assets/photos/collage/arch-02.jpg'); const b = await r.blob(); await window.LEStudio.newFromPhoto(new File([b], 'arch.jpg', { type: 'image/jpeg' })); });
    await page.addScriptTag({ url: '/assets/js/expert/mock-fx.js' });
    await page.evaluate(() => { ['webgl2', 'pointer-fine', 'device-memory-4gb'].forEach((c) => window.LE.support && window.LE.support.override(c, true)); window.LEStudio.mode('expert'); });
    await page.waitForFunction(() => window.LE.expert && window.LE.expert.active());
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ['.sx-scene', '#xp-strip', '#xp-right', '.sx-head', '.xp-scope-plot'].map((q) => { const e = document.querySelector(q); return [q, e ? getComputedStyle(e).backgroundColor : null]; }));
    r.forEach(([q, c]) => { if (c && !/, 0\)$/.test(c)) h.assert(chroma(c) < 0.006, theme + ' ' + q + ' has a hue cast: ' + c); });
    h.assert.equal(r[0][1], 'rgb(115, 115, 115)', theme + ': Expert surround is mid grey by default');
    const tool = await page.evaluate(() => { const b = document.querySelector('button.xp-tool[aria-pressed="true"]'); return b ? [getComputedStyle(b).backgroundColor, getComputedStyle(b).color] : null; });
    if (tool) h.assert(ratio(tool[1], tool[0]) >= 3, 'active tool glyph contrast ' + tool.join(' on '));
    h.assert.noErrors(page);
    await page.context().close();
  }
};

/* ---------- Themes (html[data-skin]): Clear is the default, Lapis is pass 2, plus Graphite, Paper and Contrast ---------- */
async function openSkin(browser, base, url, vp, skin, theme, opts) {
  const v = { desktop: { width: 1440, height: 900 }, small: { width: 360, height: 740 } }[vp || 'desktop'];
  const mob = v.width < 600;
  const ctx = await browser.newContext(Object.assign({ viewport: v, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: theme || 'light' }, opts || {}));
  await ctx.addInitScript(([k, t]) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('le-theme', t); if (k && k !== 'clear') localStorage.setItem('le-skin', k); else localStorage.removeItem('le-skin'); } } catch (e) {}
    requestAnimationFrame(() => { window.__firstFrameSkin = document.documentElement.getAttribute('data-skin') || 'clear'; window.__firstFrameTheme = document.documentElement.getAttribute('data-theme'); }); }, [skin, theme || 'light']);
  const page = await ctx.newPage();
  page.errors = []; page.requests = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => page.requests.push(r.url()));
  await page.goto(base + url, { waitUntil: 'networkidle' });
  return page;
}

cases['themes: the choice applies without reload, persists, and is on <html> before the first frame'] = async ({ browser, base, h }) => {
  for (const url of ['/', '/studio/', '/pdf-studio/', '/photo/']) {
    const page = await openSkin(browser, base, url, 'desktop', 'paper', 'dark');
    h.assert.equal(await page.evaluate(() => window.__firstFrameSkin), 'paper', url + ': skin set before the first frame');
    h.assert.equal(await page.evaluate(() => window.__firstFrameTheme), 'dark', url + ': mode set before the first frame');
    await page.context().close();
  }
  const page = await openSkin(browser, base, '/', 'desktop', 'clear', 'light');
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  /* The cross-fade (a view transition) applies the choice a frame later; switch it off so each read below is exact. */
  await page.addInitScript(() => { try { document.startViewTransition = undefined; } catch (e) {} });
  await page.evaluate(() => { try { document.startViewTransition = undefined; } catch (e) {} });
  await page.click('.le-top [data-appearance]');
  await page.waitForSelector('#le-appearance[open] .ap-card');
  await page.click('#le-appearance .ap-card[data-ap-skin="graphite"]');
  /* The switch runs inside a view transition where the browser has one, so the attribute lands on the next frame, not in the click itself. */
  await page.waitForFunction(() => document.documentElement.getAttribute('data-skin') === 'graphite', null, { timeout: 1500 }).catch(() => {});
  h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-skin')), 'graphite', 'applied at once');
  h.assert(bg0 !== await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'repainted without reload');
  await page.click('#le-appearance [data-ap-mode="dark"]');
  h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'mode applied');
  const meta = await page.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute('content'));
  h.assert(/#121212/i.test(meta), 'theme-color follows the theme: ' + meta);
  await page.reload({ waitUntil: 'networkidle' });
  h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-skin')), 'graphite', 'persists after reload');
  await page.evaluate(() => { window.LE.appearance.setSkin('clear'); window.LE.appearance.setMode('auto'); });
  h.assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-skin')), null, 'Clear is no attribute');
  h.assert.equal(await page.evaluate(() => localStorage.getItem('le-skin')), null, 'Clear stores nothing');
  h.assert.noErrors(page);
};

cases['themes: Clear uses the system stack and no serif accent; inactive themes load no fonts'] = async ({ browser, base, h }) => {
  let page = await openSkin(browser, base, '/', 'desktop', 'clear', 'light');
  const r = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, h1: getComputedStyle(document.querySelector('h1')).fontFamily, em: (() => { const e = document.querySelector('h1 em'); return e ? [getComputedStyle(e).fontFamily, getComputedStyle(e).fontStyle] : null; })() }));
  h.assert(/^-apple-system/.test(r.body), 'chrome uses the system stack: ' + r.body);
  h.assert(!/Instrument|Jakarta/.test(r.h1), 'headline is not the serif or Jakarta: ' + r.h1);
  if (r.em) h.assert(!/Instrument/.test(r.em[0]) && r.em[1] === 'normal', 'no serif italic accent: ' + r.em.join(' '));
  /* The serif may load for content (the design in the product shot); the Lapis interface face must not. */
  h.assert(!page.requests.some((u) => /jakarta-latin/.test(u)), 'Clear requests no Lapis interface font: ' + page.requests.filter((u) => /fonts\//.test(u)).join(', '));
  await page.context().close();
  /* The studio start screen previews designs in their own content fonts (Jakarta among them), so only marketing pages are checked. */
  for (const url of ['/photo/', '/about/']) {
    page = await openSkin(browser, base, url, 'desktop', 'clear', 'light');
    h.assert(!page.requests.some((u) => /jakarta-latin/.test(u)), url + ': Clear requests no Lapis interface font');
    await page.context().close();
  }
  page = await openSkin(browser, base, '/', 'desktop', 'lapis', 'light');
  h.assert(/Plus Jakarta Sans/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily)), 'Lapis keeps its face');
  await page.context().close();
};

cases['themes: comfort fallbacks are declared (reduced transparency, reduced motion, no blur support)'] = async ({ h }) => {
  const css = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'app.css'), 'utf8');
  h.assert(/@media \(prefers-reduced-transparency: reduce\)[\s\S]{0,300}--bar-filter: none/.test(css), 'reduced transparency turns blur off');
  h.assert(/@supports not \(\(backdrop-filter/.test(css), 'solid fallback without backdrop-filter');
  h.assert(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'reduced motion');
  ['clear', 'lapis', 'graphite', 'paper', 'contrast'].forEach((k) => h.assert(k === 'clear' || css.includes(':root[data-skin="' + k + '"]'), 'theme block ' + k));
};

['clear', 'lapis', 'graphite', 'paper', 'contrast'].forEach((skin) => {
  cases['themes: ' + skin + ' fits 360 and 1440 with no console errors on the main surfaces'] = async ({ browser, base, h }) => {
    for (const theme of ['light', 'dark']) {
      for (const vp of ['small', 'desktop']) {
        for (const url of ['/', '/photo/', '/studio/', '/pdf-studio/', '/storage-manager/']) {
          const page = await openSkin(browser, base, url, vp, skin, theme);
          await page.waitForTimeout(100);
          h.assert.noErrors(page);
          h.assert(await h.noOverflow(page), skin + ' ' + theme + ' ' + vp + ' ' + url + ' scrolls sideways');
          await page.context().close();
        }
      }
    }
  };
});

/* ---------- Pass 4: components in the default theme ---------- */
cases['components: tool-page options are switches, grouped lists are inset cards, licences fit 360'] = async ({ browser, base, h }) => {
  let page = await openSkin(browser, base, '/image-resizer/', 'small', 'clear', 'light');
  const sw = await page.evaluate(() => { const i = [...document.querySelectorAll('.check > input[type="checkbox"]')].find((x) => x.closest('.check').getBoundingClientRect().height > 0); if (!i) return null; const cs = getComputedStyle(i); const r = i.closest('.check').getBoundingClientRect(); return { role: i.getAttribute('role'), app: cs.appearance || cs.webkitAppearance, w: parseFloat(cs.width), h: parseFloat(cs.height), row: r.height }; });
  if (sw) {
    h.assert.equal(sw.role, 'switch', 'option checkbox announces itself as a switch');
    h.assert(sw.app === 'none' && sw.w >= 44 && sw.h >= 26, 'drawn as a switch: ' + JSON.stringify(sw));
    h.assert(sw.row >= 44, 'switch row is a 44 px target: ' + sw.row);
  }
  await page.context().close();
  page = await openSkin(browser, base, '/storage-manager/', 'small', 'clear', 'light');
  await page.evaluate(() => { const b = document.querySelector('[data-le-storage]'); b && b.click(); });
  await page.waitForSelector('.lp-cats');
  const g = await page.evaluate(() => { const l = document.querySelector('.lp-cats'), d = l.closest('dialog'); return { list: getComputedStyle(l).backgroundColor, sheet: getComputedStyle(d).backgroundColor, radius: parseFloat(getComputedStyle(l).borderTopLeftRadius) }; });
  h.assert(g.list !== g.sheet && g.radius >= 10, 'storage list is an inset group on the grouped background: ' + JSON.stringify(g));
  await page.context().close();
  for (const vp of ['small', 'desktop']) {
    page = await openSkin(browser, base, '/licenses/', vp, 'clear', 'light');
    h.assert(await h.noOverflow(page), '/licenses/ scrolls sideways at ' + vp);
    await page.context().close();
  }
};

cases['components: slider thumb is findable, phone tab labels are 11 px or more, one filled button in the export view'] = async ({ browser, base, h }) => {
  for (const skin of ['clear', 'paper', 'graphite', 'contrast']) {
    const page = await openSkin(browser, base, '/', 'desktop', skin, 'light');
    const sh = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--thumb-shadow'));
    const m = sh.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? (m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0;
    h.assert(alpha >= 0.35 || /#000|#000000/.test(sh), skin + ': the thumb has a visible edge: ' + sh);
    await page.context().close();
  }
  const page = await openSkin(browser, base, '/studio/', 'small', 'clear', 'light');
  await page.waitForFunction(() => window.LEStudio && window.LEStudio.scene);
  await page.evaluate(async () => { const r = await fetch('/assets/photos/collage/arch-02.jpg'); const b = await r.blob(); await window.LEStudio.newFromPhoto(new File([b], 'a.jpg', { type: 'image/jpeg' })); });
  await page.waitForTimeout(400);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.sx-tabs .sx-rail-btn')].filter((b) => b.offsetParent).map((b) => parseFloat(getComputedStyle(b).fontSize)));
  h.assert(tabs.length >= 4 && tabs.every((x) => x >= 11), 'tab labels: ' + tabs.join(', '));
  await page.evaluate(() => window.LEStudio.openPanel('export'));
  await page.waitForTimeout(500);
  const filled = await page.evaluate(() => [...document.querySelectorAll('button, a')].filter((b) => { if (!b.offsetParent) return false; const c = getComputedStyle(b).backgroundColor; const p = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); const t = document.createElement('i'); t.style.color = p; document.body.appendChild(t); const pc = getComputedStyle(t).color; t.remove(); return c === pc; }).map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 16)));
  h.assert(filled.length === 1, 'one filled primary while exporting: ' + filled.join(' | '));
  h.assert.noErrors(page);
};

cases['no retired gold, foil or amethyst literals in CSS or inline styles'] = async ({ h }) => {
  const OLD = /#(E2B15A|F3CC7C|F2D594|2A1F0A|2C220F|C9963F|E9BE6A|B9832F|F8E3AE|F6D68E|E8BD6E|E7BA66|CBB78E|7457F0|8D74FF|6A4FE8|5B3FD9|4E36C9|A893FF|B3A1FF|141318|17131F|FBF8F3|F7F6F3|F7EFDC)\b|rgba?\(\s*(226,\s*177,\s*90|242,\s*213,\s*148|185,\s*131,\s*47|116,\s*87,\s*240|42,\s*31,\s*10)\b/i;
  const bad = [];
  const scan = (file, test) => fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (test(line)) bad.push(path.relative(ROOT, file) + ':' + (i + 1) + ' ' + line.trim().slice(0, 90)); });
  const cssDir = path.join(ROOT, 'assets', 'css');
  fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).forEach((f) => scan(path.join(cssDir, f), (l) => OLD.test(l)));
  /* Inline styles: style="…" in pages and page templates, and style strings / canvas UI strokes in the shell scripts. */
  const pages = [path.join(ROOT, 'index.html'), path.join(ROOT, 'offline.html'), path.join(ROOT, '404.html'), path.join(ROOT, 'studio', 'index.html'), path.join(ROOT, 'pdf-studio', 'index.html'),
    path.join(ROOT, 'scripts', 'build.js'), path.join(ROOT, 'scripts', 'build-pages.js'), path.join(ROOT, 'assets', 'js', 'app.js'), path.join(ROOT, 'assets', 'js', 'le-pwa.js')];
  pages.filter((f) => fs.existsSync(f)).forEach((f) => scan(f, (l) => /style=|Style\s*=|theme-color|theme_color|background_color/.test(l) && OLD.test(l)));
  /* Every page's theme-color and inline styles, and the newer shell scripts (agent, link, downloads, Expert). */
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|vendor|labs|\.git|\.claude|tests|tools|fixtures|scripts)$/.test(e.name)) walk(p); }
    else if (e.name.endsWith('.html')) scan(p, (l) => /style=|<style|theme-color|le-mark|\{[^}]*(color|background|border)/.test(l) && OLD.test(l));
  });
  walk(ROOT);
  ['le-agent.js', 'le-studio-agent.js', 'le-link.js', 'le-downloads.js'].map((f) => path.join(ROOT, 'assets', 'js', f)).concat(fs.existsSync(path.join(ROOT, 'assets', 'js', 'expert')) ? fs.readdirSync(path.join(ROOT, 'assets', 'js', 'expert')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'assets', 'js', 'expert', f)) : [])
    .filter((f) => fs.existsSync(f)).forEach((f) => scan(f, (l) => /style|Style\s*=|css|setProperty/.test(l) && OLD.test(l)));
  h.assert(bad.length === 0, 'old literals: ' + bad.slice(0, 20).join(' | '));
};

cases['focus is visible (3:1) on buttons, fields, chips, segments and icon buttons'] = async ({ browser, base, h }) => {
  for (const theme of ['light', 'dark']) {
    const page = await h.openTheme(browser, base, '/', 'desktop', theme);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'focus-lab';
      box.style.cssText = 'position:fixed;left:16px;top:80px;z-index:999;padding:16px;display:grid;gap:12px;background:var(--bg)';
      box.innerHTML = '<button class="btn" id="f1">Secondary</button><button class="btn btn-primary" id="f2">Primary</button><button class="btn btn-gold" id="f3">Old name</button>' +
        '<button class="btn btn-quiet" id="f4">Quiet</button><button class="btn btn-danger" id="f5">Delete</button><input class="input" id="f6"><button class="chip" id="f7">Chip</button>' +
        '<div class="seg"><button id="f8" aria-pressed="true">One</button><button aria-pressed="false">Two</button></div><button class="le-icon" id="f9" aria-label="Icon">i</button><a href="#x" class="btn-link" id="f10">Link</a>';
      document.body.appendChild(box);
    });
    await page.keyboard.press('Tab');
    for (let i = 1; i <= 10; i++) {
      await page.focus('#f' + i);
      await page.waitForTimeout(220);
      const r = await page.evaluate((id) => {
        const e = document.getElementById(id), cs = getComputedStyle(e);
        const bg = getComputedStyle(document.getElementById('focus-lab')).backgroundColor;
        const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 ? cs.outlineColor : null;
        return { visible: e.matches(':focus-visible'), ring: outline || cs.borderColor, bg, kind: outline ? 'outline' : 'border' };
      }, 'f' + i);
      h.assert(r.visible, theme + ' #f' + i + ' matches :focus-visible');
      h.assert(ratio(r.ring, r.bg) >= 3, theme + ' #f' + i + ' focus ' + r.kind + ' ' + r.ring + ' on ' + r.bg + ' is ' + ratio(r.ring, r.bg).toFixed(2));
    }
    await page.context().close();
  }
};

cases['manifest colours and icon files match the identity'] = async ({ h }) => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  h.assert.equal(man.theme_color.toUpperCase(), '#161616', 'theme_color is the neutral editor chrome');
  h.assert.equal(man.background_color.toUpperCase(), '#FAFAFA', 'background_color is the neutral page');
  const png = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); h.assert(b.slice(1, 4).toString() === 'PNG', f + ' is a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const want = { 'assets/icons/icon-192.png': 192, 'assets/icons/icon-512.png': 512, 'assets/icons/maskable-512.png': 512, 'assets/icons/favicon-32.png': 32 };
  Object.keys(want).forEach((f) => { const [w, hh] = png(f); h.assert(w === want[f] && hh === want[f], f + ' is ' + w + 'x' + hh); });
  const [ow, oh] = png('assets/icons/og.png');
  h.assert(ow === 1200 && oh === 630, 'og.png is 1200x630');
  man.icons.forEach((i) => h.assert(fs.existsSync(path.join(ROOT, i.src)), 'manifest icon exists: ' + i.src));
  (man.shortcuts || []).forEach((s) => (s.icons || []).forEach((i) => { h.assert(fs.existsSync(path.join(ROOT, i.src)), 'shortcut icon exists: ' + i.src); h.assert.equal(png(i.src)[0], 96, i.src + ' is 96px'); }));
  ['icon.svg', 'maskable.svg'].forEach((f) => {
    const s = fs.readFileSync(path.join(ROOT, 'assets', 'icons', f), 'utf8');
    h.assert(/#0369DA/i.test(s) && /#EF8C57/i.test(s), f + ' carries the brand blue and the Apricot dot');
    h.assert(!/#E2B15A|#5b5bf7|#8b5cf6/i.test(s), f + ' has no old colours');
  });
  /* The inline marks in the shell and the studio header are the same mark. */
  ['assets/js/app.js', 'assets/js/le-studio.js', 'index.html'].forEach((f) => h.assert(fs.readFileSync(path.join(ROOT, f), 'utf8').includes('M176 140v196a40 40 0 0 0 40 40h156'), f + ' draws the new mark'));
};

cases['main surfaces: no console errors and no sideways scroll at 360 and 1440, both themes'] = async ({ browser, base, h }) => {
  const urls = ['/', '/photo/', '/collage-maker/', '/image-compressor/', '/recipes/', '/photo-privacy/', '/device-check/', '/verify/', '/storage-manager/', '/studio/', '/pdf-studio/'];
  for (const theme of ['light', 'dark']) {
    for (const vp of ['small', 'desktop']) {
      for (const url of urls) {
        if (!fs.existsSync(path.join(ROOT, url, 'index.html'))) continue;
        const page = await h.openTheme(browser, base, url, vp, theme);
        await page.waitForTimeout(150);
        h.assert.noErrors(page);
        h.assert(await h.noOverflow(page), url + ' scrolls sideways at ' + vp + ' ' + theme);
        await page.context().close();
      }
    }
  }
};

cases['a finished job gets one calm confirmation (and none under reduced motion animation)'] = async ({ browser, base, h }) => {
  const page = await h.open(browser, base, '/image-compressor/', 'desktop');
  await page.evaluate(() => window.IT.celebrate('Saved on this device'));
  const on = await page.evaluate(() => { const t = document.querySelector('.toast'); const b = getComputedStyle(t, '::before'); return { done: t.classList.contains('is-done'), shown: t.classList.contains('show'), anim: b.animationName, text: t.textContent }; });
  h.assert(on.done && on.shown && /Saved/.test(on.text), 'celebrate shows a done toast: ' + JSON.stringify(on));
  h.assert(/le-done-pop/.test(on.anim), 'the check animates in: ' + on.anim);
  await page.evaluate(() => window.IT.say('Plain message'));
  h.assert(!(await page.evaluate(() => document.querySelector('.toast').classList.contains('is-done'))), 'a plain message is not a celebration');
  const rm = await h.open(browser, base, '/image-compressor/', 'desktop', { reducedMotion: 'reduce' });
  await rm.evaluate(() => window.IT.celebrate('Saved on this device'));
  const d = await rm.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.toast'), '::before').animationDuration));
  h.assert(d < 0.01, 'reduced motion: no animation (' + d + 's)');
};

module.exports = cases;
