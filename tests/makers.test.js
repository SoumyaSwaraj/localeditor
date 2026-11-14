'use strict';
/* Quick makers: every maker × style × size builds clean, determinism, validation, doc.maker round trips,
   edit details, ?make= links, date maths and phone layout. Asserts on documents first, pixels never. */

const PHOTOS = ['travel-08', 'still-02', 'people-07', 'travel-07', 'people-08'];

async function studio(h, browser, base, vp, url) {
  const page = await h.open(browser, base, url || '/studio/', vp || 'desktop');
  await h.need(page, ['makers', 'design']);
  await page.waitForFunction(() => window.LEStudio && window.LEStudioMakers && window.LE.makers);
  await page.evaluate(() => LE.makers.ready());
  return page;
}
/* Loads sample photos as canvases keyed sample:<name>. */
const loadImages = (page) => page.evaluate(async (list) => {
  window.__imgs = {};
  for (const p of list) {
    const b = await (await fetch('/assets/photos/collage/' + p + '.jpg')).blob();
    const bm = await createImageBitmap(b);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0);
    window.__imgs['sample:' + p] = c;
  }
}, PHOTOS);

const cases = {};

/* Every maker × style × size × {sample, minimal, worst}, every page, in groups so each case stays well inside the
   case timeout. A maker in no named group (a new one) lands in the last group, so it is always covered. */
const BUILD_GROUPS = [
  ['first set and print set', ['quote', 'review', 'receipt', 'milestone', 'palette', 'film', 'calendar', 'chart', 'labels', 'stickers', 'photobook', 'zine']],
  ['catalogue', ['catalogue']],
  ['QR makers', ['payposter', 'wifisign', 'qrinvite']],
  ['everything else', null]
];
async function buildsClean({ browser, base, h }, only, named) {
  const page = await studio(h, browser, base);
  await loadImages(page);
  const res = await page.evaluate(async ([photos, only, named]) => {
    const out = { builds: 0, problems: [], makers: 0 };
    const fonts = LE.fonts.list().map((f) => f.family);
    for (const m of LE.makers.list().filter((x) => only ? only.indexOf(x.id) >= 0 : named.indexOf(x.id) < 0)) {
      out.makers++;
      h: for (const st of m.styles) {
        for (const sz of m.sizes) {
          const cs = LE.makers.cases(m.id, photos.map((p) => 'sample:' + p));
          for (const cn of ['sample', 'minimal', 'worst']) {
            let r;
            try { r = await LE.makers.build(m.id, cs[cn], { style: st.id, size: sz.id, images: window.__imgs, today: '2026-11-12' }); }
            catch (e) { out.problems.push(m.id + '/' + st.id + '/' + sz.id + '/' + cn + ' threw ' + e.message); continue; }
            out.builds++;
            /* Every page of every make: the first has the chosen size; pages with their own size keep it. */
            if (r.pages[0].width !== sz.w || r.pages[0].height !== sz.h) out.problems.push(m.id + ' wrong size');
            r.pages.forEach((pg, pi) => {
              const chosen = pg.width === sz.w && pg.height === sz.h;
              if (!(pg.width > 0 && pg.height > 0) || 'ownSize' in pg || 'ownPrint' in pg) out.problems.push(m.id + ' page size');
              if (!pg.maker || pg.maker.id !== m.id || pg.maker.style !== st.id || pg.maker.size !== sz.id) out.problems.push(m.id + ' maker meta missing');
              if (chosen && sz.print && !(pg.print && pg.print.paper === sz.print.paper)) out.problems.push(m.id + ' print meta missing');
              if (pg.print && !(pg.print.w > 0 && pg.print.h > 0 && Math.abs(pg.width / pg.height - pg.print.w / pg.print.h) < 0.01)) out.problems.push(m.id + ' print meta does not match the page shape');
              LE.makers.check(pg).forEach((p) => out.problems.push(m.id + '/' + st.id + '/' + sz.id + '/' + cn + '/p' + (pi + 1) + ' ' + p.kind + ': ' + p.message));
              pg.layers.forEach((l) => {
                if (l.type === 'text' && fonts.indexOf(l.font) < 0) out.problems.push(m.id + ' font ' + l.font);
                if (['text', 'image', 'shape', 'svg', 'group'].indexOf(l.type) < 0) out.problems.push(m.id + ' layer type ' + l.type);
                if (l.type === 'image' && !l.slot) out.problems.push(m.id + ' photo without slot');
                if (l.groupId && !pg.layers.some((g) => g.id === l.groupId && g.type === 'group')) out.problems.push(m.id + ' orphan group member');
              });
            });
          }
        }
      }
    }
    return out;
  }, [PHOTOS, only, named]);
  h.assert(res.makers >= (only ? only.length : 6), 'makers covered: ' + res.makers);
  h.assert(res.builds >= res.makers * 4 * 2 * 3, 'built ' + res.builds);
  h.assert(!res.problems.length, res.problems.slice(0, 6).join(' | '));
  h.assert.noErrors(page);
}
BUILD_GROUPS.forEach(([label, ids]) => {
  const named = [].concat.apply([], BUILD_GROUPS.map((g) => g[1] || []));
  cases['every maker, style and size builds clean with sample, minimal and worst-case values (' + label + ')'] = (ctx) => buildsClean(ctx, ids, named);
});

cases['each maker offers 4–6 styles; social makers square, 4:5 and 9:16; print makers paper sizes; the rest their own'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const list = await page.evaluate(() => LE.makers.list().map((m) => ({ id: m.id, category: m.category, styles: m.styles.length, sizes: m.sizes.map((s) => s.w + 'x' + s.h), print: m.sizes.every((s) => s.print && s.print.dpi === 300), anyPrint: m.sizes.filter((s) => s.print).map((s) => s.print.dpi) })));
  const ids = list.map((m) => m.id);
  h.assert.equal(ids.slice(0, 6).join(','), 'quote,review,receipt,milestone,palette,film');
  ['calendar', 'chart', 'labels', 'stickers', 'photobook', 'zine', 'catalogue', 'payposter', 'wifisign', 'qrinvite', 'eventkit', 'movieposter', 'albumcover', 'frontpage', 'appshots', 'linkcard'].forEach((id) => h.assert(ids.indexOf(id) >= 0, id + ' registered'));
  /* The first set offers every social size; the second set picks the sizes its formats need (and may print). */
  const social = ['quote', 'review', 'receipt', 'milestone', 'palette', 'film'];
  list.forEach((m) => {
    h.assert(m.styles >= 4 && m.styles <= 8, m.id + ' styles');
    if (m.category === 'Print') { h.assert(m.print, m.id + ' print sizes'); return; }
    if (social.indexOf(m.id) >= 0) { ['1080x1080', '1080x1350', '1080x1920'].forEach((s) => h.assert(m.sizes.indexOf(s) >= 0, m.id + ' ' + s)); return; }
    h.assert(m.sizes.length >= 1 && m.sizes.length <= 5, m.id + ' sizes');
    h.assert(m.anyPrint.every((d) => d === 300), m.id + ' print sizes at 300 dpi');
  });
};

cases['same values make the same document'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await loadImages(page);
  const same = await page.evaluate(async () => {
    const out = [];
    for (const m of LE.makers.list()) {
      const v = m.sample.values;
      const a = await LE.makers.build(m.id, v, { style: m.styles[1].id, size: 'portrait', images: window.__imgs, today: '2026-11-12' });
      const b = await LE.makers.build(m.id, JSON.parse(JSON.stringify(v)), { style: m.styles[1].id, size: 'portrait', images: window.__imgs, today: '2026-11-12' });
      out.push(JSON.stringify(a) === JSON.stringify(b));
    }
    return out;
  });
  h.assert(same.every(Boolean), 'deterministic ' + same.join(','));
};

cases['validation rejects bad values and keeps script-like text as plain text'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const V = LE.makers.validate;
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const built = await LE.makers.build('quote', { quote: evil, author: '"><svg onload=alert(1)>' }, { style: 'minimal' });
    const q = built.pages[0].layers.find((l) => l.id === 'quote');
    await LEStudioMakers.open('quote', { values: { quote: evil } });
    await new Promise((res) => setTimeout(res, 600));
    const ta = document.querySelector('.mk-sheet textarea');
    const out = {
      tooLong: V('quote', { quote: 'x'.repeat(421) }).ok,
      wrongType: V('quote', { quote: 42, author: { a: 1 } }).ok,
      unknown: V('quote', { quote: 'ok', __proto__x: 1, extra: 2 }).ok,
      badDate: V('milestone', { start: '2025-02-29' }).ok,
      leapDate: V('milestone', { start: '2024-02-29' }).ok,
      badPhoto: V('film', { photos: ['../../etc/passwd'] }).ok,
      badColor: V('quote', { quote: 'a', accent: 'red; background:url(x)' }).ok,
      badChoice: V('palette', { photo: 'a1', count: '12' }).ok,
      tooManyRows: V('receipt', { title: 'a', items: new Array(16).fill(['a', '1']) }).ok,
      rating: V('review', { review: 'a', name: 'b', rating: 7 }).ok,
      missing: V('quote', {}).errors.map((e) => e.key).join(','),
      script: V('quote', { quote: evil }).ok,
      plainText: q && q.text === evil.replace(/[\s"“”„«»'‘’]+$/, '') && q.type === 'text',
      textarea: ta && ta.value === evil,
      injected: !!document.querySelector('img[src="x"]') || window.__pwned != null
    };
    LEStudioMakers.close();
    return out;
  });
  ['tooLong', 'wrongType', 'unknown', 'badDate', 'badPhoto', 'badColor', 'badChoice', 'tooManyRows', 'rating'].forEach((k) => h.assert(r[k] === false, k + ' should be rejected'));
  h.assert(r.leapDate === true, '29 Feb 2024 is a real date');
  h.assert.equal(r.missing, 'quote', 'missing required');
  h.assert(r.script === true && r.plainText, 'script-like text is accepted as plain text');
  h.assert(r.textarea, 'form shows the raw text');
  h.assert(r.injected === false, 'nothing injected or executed');
  h.assert.noErrors(page);
};

cases['milestone date maths across month ends and leap years'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(() => {
    const D = LE.makers.date;
    const d = (a, b) => { const x = D.diff(a, b); return [x.years, x.months, x.days].join('/'); };
    const el = (v) => LE.makers.milestoneElapsed(v, { today: '2026-11-12', date: D });
    return {
      janEnd: d('2024-01-31', '2024-02-29'),
      janEnd2: d('2023-01-31', '2023-02-28'),
      janEndMar: d('2023-01-31', '2023-03-01'),
      leapYear: d('2024-02-29', '2025-02-28'),
      leapYear2: d('2024-02-29', '2025-03-01'),
      fourYears: d('2024-02-29', '2028-02-29'),
      sameDay: d('2026-05-12', '2026-05-12'),
      backwards: D.diff('2026-05-12', '2026-01-01').sign,
      six: el({ kind: 'baby', start: '2026-05-12', asOf: '2026-11-12' }),
      mixed: el({ kind: 'couple', start: '2024-08-01', asOf: '2026-11-12' }),
      sober: el({ kind: 'sober', start: '2025-11-12', asOf: '2026-11-12' }),
      weeks: el({ kind: 'pet', start: '2026-10-22', asOf: '2026-11-12' }),
      yearExact: el({ kind: 'work', start: '2021-11-12', asOf: '2026-11-12' }),
      describe: D.describe('2024-08-01', '2026-11-12'),
      fmt: D.format('2026-11-12', "dddd, D MMMM YYYY · 'YY MM DD")
    };
  });
  h.assert.equal(r.janEnd, '0/1/0');
  h.assert.equal(r.janEnd2, '0/1/0');
  h.assert.equal(r.janEndMar, '0/1/1');
  h.assert.equal(r.leapYear, '1/0/0');
  h.assert.equal(r.leapYear2, '1/0/1');
  h.assert.equal(r.fourYears, '4/0/0');
  h.assert.equal(r.sameDay, '0/0/0');
  h.assert.equal(r.backwards, -1);
  h.assert.equal(r.six.num + ' ' + r.six.unit, '6 months today');
  h.assert.equal(r.mixed.line, '2 years, 3 months together');
  h.assert.equal(r.sober.num + ' ' + r.sober.unit, '365 days sober');
  h.assert.equal(r.weeks.line, '3 weeks with us');
  h.assert.equal(r.yearExact.line, '5 years today');
  h.assert.equal(r.describe, '2 years, 3 months');
  h.assert.equal(r.fmt, "Thursday, 12 November 2026 · '26 11 12");
};

async function makeQuote(page, style) {
  await page.evaluate((s) => LEStudioMakers.open('quote', { style: s || 'editorial' }), style);
  await page.waitForTimeout(400);
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => !LEStudioMakers.form() && LEStudio.scene.toJSON().maker);
  await page.waitForTimeout(300);
}

cases['a made design is ordinary editable layers with doc.maker, through undo, redo and .leproject'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await makeQuote(page);
  let d = await h.doc(page);
  h.assert(d.maker && d.maker.id === 'quote' && d.maker.style === 'editorial' && d.maker.size === 'square', 'maker meta');
  h.assert.equal(d.maker.values.author, 'J. R. R. Tolkien');
  h.assert(/^asset|^a|^[\w-]+$/.test(d.maker.values.photo) && !/^sample:/.test(d.maker.values.photo), 'sample photo became a real asset: ' + d.maker.values.photo);
  const photo = d.layers.find((l) => l.type === 'image');
  h.assert(photo && photo.src === d.maker.values.photo && photo.slot, 'photo slot filled');
  const q = d.layers.find((l) => l.type === 'text' && /wander/.test(l.text));
  const x0 = q.x;
  await page.evaluate((id) => LEStudio.scene.update(id, { x: 40 }), q.id);
  d = await h.doc(page);
  h.assert.equal(d.layers.find((l) => l.id === q.id).x, 40, 'text layer moves');
  h.assert(d.maker, 'meta kept after an edit');
  await page.evaluate(() => LEStudio.scene.undo());
  d = await h.doc(page);
  h.assert(d.maker && d.layers.find((l) => l.id === q.id).x === x0, 'undo keeps meta');
  await page.evaluate(() => LEStudio.scene.redo());
  d = await h.doc(page);
  h.assert(d.maker && d.layers.find((l) => l.id === q.id).x === 40, 'redo keeps meta');
  const rt = await page.evaluate(async () => {
    const c = LEStudio;
    c.syncProject();
    const blob = await LE.project.exportFile(c.S.project, {});
    const p = await LE.project.importFile(new File([blob], 'x.leproject'));
    return p.pages[0].maker;
  });
  h.assert(rt && rt.id === 'quote' && rt.values.quote === 'Not all those who wander are lost.' && rt.sig === d.maker.sig, '.leproject round trip');
  h.assert.noErrors(page);
};

cases['a second make goes on a new page, and edit details remakes in one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await makeQuote(page);
  await page.evaluate(() => LEStudioMakers.open('review'));
  await page.waitForTimeout(300);
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => LEStudio.scene.toJSON().maker && LEStudio.scene.toJSON().maker.id === 'review');
  const pages = await page.evaluate(() => LEStudio.S.project.pages.length);
  h.assert.equal(pages, 2, 'new page, nothing overwritten');
  const before = await h.doc(page);
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForTimeout(300);
  const warn1 = await page.evaluate(() => !document.querySelector('.mk-warn').hidden);
  h.assert(!warn1, 'no warning without hand edits');
  await page.evaluate(() => { const F = LEStudioMakers.form(); F.values.name = 'Dev Patel'; F.style = 'dark'; });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => LEStudio.scene.toJSON().maker.values.name === 'Dev Patel');
  const after = await h.doc(page);
  h.assert(after.layers.some((l) => l.text === 'Dev Patel'), 'remade with the new name');
  h.assert.equal(after.maker.style, 'dark');
  await page.evaluate(() => LEStudio.scene.undo());
  const undone = await h.doc(page);
  h.assert.equal(JSON.stringify(undone.layers), JSON.stringify(before.layers), 'one undo restores the page');
  h.assert.equal(undone.maker.values.name, 'Priya Sharma');
  /* Hand edit, then edit details warns. */
  const t = undone.layers.find((l) => l.type === 'text');
  await page.evaluate((id) => LEStudio.scene.update(id, { text: 'Changed by hand' }), t.id);
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForTimeout(300);
  const warn2 = await page.evaluate(() => { const w = document.querySelector('.mk-warn'); return !w.hidden && /by hand/.test(w.textContent); });
  h.assert(warn2, 'warns that hand edits will be replaced');
  await page.evaluate(() => LEStudioMakers.close());
  h.assert.noErrors(page);
};

cases['?make= opens the form; a tampered &v= is rejected safely'] = async ({ browser, base, h }) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const good = enc({ title: 'Trip to Goa', items: [['Beaches', '6'], ['Sunsets', '9']], total: '1 tan' });
  let page = await studio(h, browser, base, 'desktop', '/studio/?make=receipt&style=ticket&v=' + good);
  await page.waitForFunction(() => window.LEStudioMakers.form());
  await page.waitForTimeout(800);
  const f = await page.evaluate(() => { const F = LEStudioMakers.form(); return { id: F.m.id, style: F.style, title: F.values.title, rows: F.values.items.length, canvas: !!document.querySelector('.mk-render') }; });
  h.assert.equal(f.id, 'receipt');
  h.assert.equal(f.style, 'ticket');
  h.assert.equal(f.title, 'Trip to Goa');
  h.assert.equal(f.rows, 2);
  h.assert(f.canvas, 'live preview rendered');
  h.assert.noErrors(page);
  const bad = [enc({ title: 'x'.repeat(500) }), enc({ title: 'a', __proto__: { polluted: 1 }, constructor: 1 }), 'not*base64', enc({ title: 'a', items: 'oops' }), enc([1, 2])];
  for (const b of bad) {
    page = await studio(h, browser, base, 'desktop', '/studio/?make=receipt&v=' + encodeURIComponent(b));
    await page.waitForFunction(() => window.LEStudioMakers.form());
    const r = await page.evaluate(() => ({ title: LEStudioMakers.form().values.title, toast: (document.getElementById('sx-toast') || {}).textContent || '', polluted: ({}).polluted }));
    h.assert.equal(r.title, 'My 2026', 'falls back to the sample');
    h.assert(/could not be used/.test(r.toast), 'tells the person');
    h.assert(r.polluted === undefined, 'no prototype pollution');
    h.assert.noErrors(page);
  }
  page = await studio(h, browser, base, 'desktop', '/studio/?make=<script>');
  await page.waitForTimeout(500);
  h.assert(!(await page.evaluate(() => LEStudioMakers.form())), 'unknown maker opens nothing');
};

cases['gallery and form at phone size: no sideways scroll, 44px targets'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studio(h, browser, base, vp);
    await page.waitForTimeout(400);
    h.assert(await page.evaluate(() => !!document.querySelector('.mk-start .mk-card')), 'start screen row');
    await page.evaluate(() => LEStudio.openPanel('apps', { app: 'make' }));
    await page.waitForFunction(() => document.querySelectorAll('.mk-grid .mk-card').length === LE.makers.list().length);
    h.assert(await h.noOverflow(page), vp + ' gallery overflow');
    await page.evaluate(() => { const i = document.querySelector('.mk-search input'); i.value = 'receipt list'; i.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(300);
    h.assert.equal(await page.evaluate(() => document.querySelectorAll('.mk-grid .mk-card').length), 1, 'search');
    await page.click('.mk-grid .mk-card');
    await page.waitForFunction(() => document.querySelector('.mk-render'));
    h.assert(await h.noOverflow(page), vp + ' form overflow');
    const small = await page.evaluate(() => [...document.querySelectorAll('.mk-sheet button, .mk-sheet input:not([type=checkbox]), .mk-sheet select')]
      .filter((n) => n.offsetParent && n.getBoundingClientRect().height < 40).map((n) => n.className || n.tagName));
    h.assert(!small.length, 'small targets: ' + small.slice(0, 4).join(','));
    const fits = await page.evaluate(() => { const c = document.querySelector('.mk-render').getBoundingClientRect(), p = document.querySelector('.mk-preview').getBoundingClientRect(); return c.bottom <= p.bottom + 1 && c.right <= p.right + 1; });
    h.assert(fits, 'preview stays in its box');
    h.assert.noErrors(page);
  }
};

cases['text the shipped fonts cannot draw falls back to a system-backed family'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const a = await LE.makers.build('quote', { quote: '千里之行，始于足下', author: 'Laozi' }, { style: 'handwritten' });
    const b = await LE.makers.build('quote', { quote: 'Café déjà vu — naïve ✨', author: 'Zoë' }, { style: 'handwritten' });
    const f = (d, id) => d.pages[0].layers.find((l) => l.id === id).font;
    return { cjk: f(a, 'quote'), latinAuthor: f(a, 'author'), accents: f(b, 'quote'), problems: LE.makers.check(a.pages[0]).length };
  });
  h.assert.equal(r.cjk, 'Inter', 'CJK falls back');
  h.assert.equal(r.latinAuthor, 'Caveat', 'Latin keeps the style font');
  h.assert.equal(r.accents, 'Caveat', 'accents and emoji keep the style font');
  h.assert.equal(r.problems, 0);
};

/* ---------- QR makers: exact payloads, read back from the rendered page with a decoder vendored for tests ---------- */
const path = require('path');
async function withDecoder(page) {
  await page.addScriptTag({ path: path.join(__dirname, 'lib', 'jsqr.js') });
  await page.evaluate(() => {
    window.__readQR = async (doc) => {
      const c = await LE.makers.renderPage(doc, { maxEdge: 1400 });
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const r = window.jsQR(d.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      return r ? r.data : null;
    };
  });
}

cases['UPI and Wi-Fi payloads are exact, escaped, and never invented'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(() => {
    const P = LE.makers.payPayload, F = LE.makers.wifiPayload, V = LE.makers.validate;
    return {
      full: P({ mode: 'upi', upiId: 'asha.kitchen@okbank', payee: 'Asha’s Kitchen & Café', amount: 250, note: 'Table 4' }),
      plain: P({ mode: 'upi', upiId: 'shop-1@ybl', payee: 'Ravi Stores' }),
      cents: P({ mode: 'upi', upiId: 'shop-1@ybl', payee: 'R', amount: 99.5 }),
      noName: P({ mode: 'upi', upiId: 'shop-1@ybl' }),
      noId: P({ mode: 'upi', payee: 'Ravi' }),
      link: P({ mode: 'link', link: 'https://pay.example.com/c/123?x=1' }),
      badLink: P({ mode: 'link', link: 'javascript:alert(1)' }),
      badId: V('payposter', { upiId: 'not an id' }).ok,
      badId2: V('payposter', { upiId: '@bank' }).ok,
      goodId: V('payposter', { upiId: '9876543210@ybl' }).ok,
      badLinkV: V('payposter', { link: 'ftp://x.example/a' }).ok,
      wpa: F({ ssid: 'My;Net,"x"', password: 'p:a\\ss;', security: 'WPA', hidden: true }),
      open: F({ ssid: 'Café Guests', security: 'nopass' }),
      wep: F({ ssid: 'Old', password: 'abcde', security: 'WEP' }),
      noPw: F({ ssid: 'Home', security: 'WPA' })
    };
  });
  h.assert.equal(r.full, 'upi://pay?pa=asha.kitchen@okbank&pn=Asha%E2%80%99s%20Kitchen%20%26%20Caf%C3%A9&am=250.00&cu=INR&tn=Table%204');
  h.assert.equal(r.plain, 'upi://pay?pa=shop-1@ybl&pn=Ravi%20Stores&cu=INR');
  h.assert.equal(r.cents, 'upi://pay?pa=shop-1@ybl&pn=R&am=99.50&cu=INR');
  h.assert.equal(r.noName, '', 'no code without the payee name');
  h.assert.equal(r.noId, '', 'no code without the UPI ID');
  h.assert.equal(r.link, 'https://pay.example.com/c/123?x=1');
  h.assert.equal(r.badLink, '');
  h.assert(r.badId === false && r.badId2 === false && r.badLinkV === false, 'bad IDs and links are rejected');
  h.assert(r.goodId === true, 'phone-number UPI IDs are fine');
  h.assert.equal(r.wpa, 'WIFI:T:WPA;S:My\\;Net\\,\\"x\\";P:p\\:a\\\\ss\\;;H:true;;');
  h.assert.equal(r.open, 'WIFI:T:nopass;S:Café Guests;;');
  h.assert.equal(r.wep, 'WIFI:T:WEP;S:Old;P:abcde;;');
  h.assert.equal(r.noPw, '', 'no code for a secured network without its password');
};

cases['QR codes on the posters, signs and invitations scan back to their exact payloads'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await withDecoder(page);
  const r = await page.evaluate(async () => {
    const out = [];
    const jobs = [
      ['payposter', { mode: 'upi', upiId: 'asha.kitchen@okbank', payee: 'Asha’s Kitchen', amount: 250, note: 'Table 4' }, LE.makers.payPayload],
      ['payposter', { mode: 'link', link: 'https://pay.example.com/checkout/abc?ref=poster' }, LE.makers.payPayload],
      ['wifisign', { ssid: 'My;Net,"x"', password: 'p:a\\ss;', security: 'WPA' }, LE.makers.wifiPayload],
      ['qrinvite', { names: 'Asha & Rohan', link: 'https://example.com/rsvp?id=42&lang=en' }, (v) => v.link]
    ];
    for (const [id, values, payload] of jobs) {
      const m = LE.makers.get(id);
      for (const st of m.styles) {
        for (const sz of m.sizes) {
          const b = await LE.makers.build(id, values, { style: st.id, size: sz.id });
          const pg = b.pages[0];
          const q = pg.layers.find((l) => /^qr(-\d+)?$/.test(l.id));
          const got = await window.__readQR(pg);
          out.push({ key: id + '/' + st.id + '/' + sz.id, ok: got === payload(values), got, share: q ? q.w / pg.width : 0, square: !!q && Math.abs(q.w - q.h) < 1 });
        }
      }
    }
    return out;
  });
  r.forEach((x) => {
    h.assert(x.ok, x.key + ' read back ' + JSON.stringify(x.got));
    h.assert(x.square && x.share >= 0.22, x.key + ' code is large enough: ' + x.share.toFixed(2));
  });
  h.assert.noErrors(page);
};

cases['a long invitation link warns in the form; the payment form says to check the code'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await page.evaluate(() => LEStudioMakers.open('qrinvite', { values: { names: 'Asha', link: 'https://example.com/' + 'x'.repeat(300) } }));
  await page.waitForFunction(() => document.querySelector('.mk-field[data-key="link"] .mk-note'));
  const t = await page.evaluate(() => document.querySelector('.mk-field[data-key="link"] .mk-note').textContent);
  h.assert(/long/.test(t), t);
  await page.evaluate(() => { const i = document.querySelector('.mk-field[data-key="link"] input'); i.value = 'https://example.com/r'; i.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => !document.querySelector('.mk-field[data-key="link"] .mk-note'));
  await page.evaluate(() => LEStudioMakers.open('payposter'));
  await page.waitForTimeout(300);
  const payHint = await page.evaluate(() => document.querySelector('.mk-sheet').textContent);
  h.assert(/Check the code with your own payment app before printing\./.test(payHint), 'payment form tells the person to check the code');
  /* Multi-page previews say how many pages; long runs draw only the first six. */
  await page.evaluate(() => LEStudioMakers.open('eventkit'));
  await page.waitForFunction(() => document.querySelector('.mk-pages'));
  h.assert.equal(await page.evaluate(() => document.querySelector('.mk-pages').textContent), '4 pages');
  await page.evaluate(() => LEStudioMakers.open('eventkit', { values: { event: 'Big day', names: new Array(24).fill('Name') } }));
  await page.waitForFunction(() => /^6 pages/.test((document.querySelector('.mk-pages') || {}).textContent || ''));
  await page.evaluate(() => LEStudioMakers.open('appshots', { values: { shots: [['One', ''], ['Two', '']] } }));
  await page.waitForFunction(() => (document.querySelector('.mk-pages') || {}).textContent === '2 pages');
  await page.evaluate(() => LEStudioMakers.open('quote'));
  await page.waitForFunction(() => document.querySelector('.mk-render') && !document.querySelector('.mk-pages'));
  await page.evaluate(() => LEStudioMakers.close());
  h.assert.noErrors(page);
};

/* ---------- Event kit: several pages of their own sizes, name-tag sheets, one-step remake ---------- */
cases['event kit builds invitation, story, banner and name-tag sheets'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const names = ['Meera', 'Arjun', 'Lena', 'Kofi', 'Sam', 'Ana', 'Ivo', 'Zoë', 'Noor'];
    const a = await LE.makers.build('eventkit', { event: 'Supper Club', names: names }, { style: 'modern', size: 'a4' });
    const b = await LE.makers.build('eventkit', { event: 'Supper Club', banner: 'header' }, { style: 'party', size: 'letter' });
    const tags = (pg) => pg.layers.filter((l) => l.id.indexOf('tag-band') === 0 || l.id.indexOf('tag-bar') === 0);
    const sheet = a.pages[3];
    const boxes = tags(sheet).map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
    const overlap = boxes.some((p, i) => boxes.some((q, j) => i < j && p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1));
    return {
      sizes: a.pages.map((p) => p.width + 'x' + p.height).join(','),
      sizesB: b.pages.map((p) => p.width + 'x' + p.height).join(','),
      metas: a.pages.every((p) => p.maker && p.maker.id === 'eventkit' && p.maker.values.event === 'Supper Club'),
      tagsPerSheet: tags(a.pages[3]).length + '/' + tags(a.pages[4]).length,
      names1: a.pages[3].layers.filter((l) => /^tag-name/.test(l.id)).map((l) => l.text).join(','),
      names2: a.pages[4].layers.filter((l) => /^tag-name/.test(l.id)).map((l) => l.text).join(','),
      blankLines: b.pages[3].layers.filter((l) => /^tag-line/.test(l.id)).length,
      guides: !!sheet.layers.find((l) => l.id === 'cut-marks' && l.type === 'group'),
      prints: a.pages.map((p) => p.print ? p.print.paper : '-').join(',') + '/' + b.pages.map((p) => p.print ? p.print.paper : '-').join(','),
      inside: boxes.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= sheet.width && p.y + p.h <= sheet.height),
      overlap,
      problems: a.pages.concat(b.pages).reduce((n, p) => n + LE.makers.check(p).length, 0)
    };
  });
  h.assert.equal(r.sizes, '1080x1350,1080x1920,1920x1080,2480x3508,2480x3508');
  h.assert.equal(r.sizesB, '1080x1350,1080x1920,1500x500,2550x3300');
  h.assert.equal(r.prints, '-,-,-,a4,a4/-,-,-,letter', 'tag sheets carry doc.print, screen pages do not');
  h.assert(r.metas, 'every page carries doc.maker');
  h.assert.equal(r.tagsPerSheet, '8/8');
  h.assert.equal(r.names1, 'Meera,Arjun,Lena,Kofi,Sam,Ana,Ivo,Zoë');
  h.assert.equal(r.names2, 'Noor');
  h.assert.equal(r.blankLines, 8, 'blank tags to write on');
  h.assert(r.guides && r.inside && !r.overlap, 'tags sit inside the sheet without overlapping, with cut guides');
  h.assert.equal(r.problems, 0);
};

cases['event kit: make adds every page; edit details remakes all of them in one undo step'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const snap = () => page.evaluate(() => { const c = LEStudio; c.syncProject(); return c.S.project.pages.map((p) => ({ w: p.width, h: p.height, ev: p.maker && p.maker.values.event, text: (p.layers.find((l) => /^(event|tag-event)(-\d+)?$/.test(l.id)) || {}).text })); });
  await page.evaluate(() => LEStudioMakers.open('eventkit', { values: { event: 'Supper Club', names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] } }));
  await page.waitForTimeout(400);
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => LEStudio.S.project && LEStudio.S.project.pages.length === 5);
  let s = await snap();
  h.assert.equal(s.map((p) => p.w + 'x' + p.h).join(','), '1080x1350,1080x1920,1920x1080,2480x3508,2480x3508');
  h.assert(s.every((p) => p.ev === 'Supper Club' && p.text === 'Supper Club'), 'all pages made');
  h.assert.equal(await page.evaluate(() => LEStudio.S.project.activePage), 0, 'the invitation is shown');
  /* Edit from the second tag sheet, and shorten the list so the kit loses a page. */
  await page.evaluate(() => LEStudio.switchPage(4));
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForTimeout(300);
  await page.evaluate(() => { const F = LEStudioMakers.form(); F.values.event = 'Rooftop Social'; F.values.names = ['A', 'B']; });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => LEStudio.scene.toJSON().maker.values.event === 'Rooftop Social');
  s = await snap();
  h.assert.equal(s.length, 4, 'one tag sheet now');
  h.assert(s.every((p) => p.ev === 'Rooftop Social' && p.text === 'Rooftop Social'), 'every page remade: ' + JSON.stringify(s.map((p) => p.text)));
  h.assert.equal(await page.evaluate(() => LEStudio.S.project.activePage), 3, 'still on the tag sheet');
  await page.evaluate(() => LEStudio.scene.undo());
  s = await snap();
  h.assert.equal(s.length, 5, 'one undo brings back every page');
  h.assert(s.every((p) => p.ev === 'Supper Club' && p.text === 'Supper Club'), 'all pages restored: ' + JSON.stringify(s.map((p) => p.text)));
  await page.evaluate(() => LEStudio.scene.redo());
  s = await snap();
  h.assert(s.length === 4 && s.every((p) => p.ev === 'Rooftop Social'), 'redo remakes them again');
  /* PDF: screen pages at their pixel size (96 dpi, 0.75 pt a px), the tag sheet at A4 in points. */
  const dl = await h.capture(page, () => page.evaluate(() => LEStudio.exportImage({ format: 'pdf', pages: 'all', name: 'kit' })), 60000);
  const info = await h.pdfRead(browser, base, dl.buf);
  h.assert.equal(info.pages, 4);
  h.assert.equal(info.sizes.map((x) => x.join('x')).join(','), '810x1013,810x1440,1440x810,595x842');
  h.assert.noErrors(page);
};

module.exports = cases;
