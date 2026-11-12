'use strict';
/* Quick makers: every maker × style × size builds clean, determinism, validation, doc.maker round trips,
   edit details, ?make= links, date maths and phone layout. Asserts on documents first, pixels never. */

const PHOTOS = ['travel-08', 'still-02', 'people-07', 'travel-07', 'people-08'];

async function studio(h, browser, base, vp, url) {
  const page = await h.open(browser, base, url || '/studio/', vp || 'desktop');
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

cases['every maker, style and size builds clean with sample, minimal and worst-case values'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await loadImages(page);
  const res = await page.evaluate(async (photos) => {
    const out = { builds: 0, problems: [] };
    const fonts = LE.fonts.list().map((f) => f.family);
    for (const m of LE.makers.list()) {
      h: for (const st of m.styles) {
        for (const sz of m.sizes) {
          const cs = LE.makers.cases(m.id, photos.map((p) => 'sample:' + p));
          for (const cn of ['sample', 'minimal', 'worst']) {
            let r;
            try { r = await LE.makers.build(m.id, cs[cn], { style: st.id, size: sz.id, images: window.__imgs, today: '2026-11-12' }); }
            catch (e) { out.problems.push(m.id + '/' + st.id + '/' + sz.id + '/' + cn + ' threw ' + e.message); continue; }
            out.builds++;
            const pg = r.pages[0];
            if (pg.width !== sz.w || pg.height !== sz.h) out.problems.push(m.id + ' wrong size');
            if (!pg.maker || pg.maker.id !== m.id || pg.maker.style !== st.id || pg.maker.size !== sz.id) out.problems.push(m.id + ' maker meta missing');
            LE.makers.check(pg).forEach((p) => out.problems.push(m.id + '/' + st.id + '/' + sz.id + '/' + cn + ' ' + p.kind + ': ' + p.message));
            pg.layers.forEach((l) => {
              if (l.type === 'text' && fonts.indexOf(l.font) < 0) out.problems.push(m.id + ' font ' + l.font);
              if (['text', 'image', 'shape', 'svg'].indexOf(l.type) < 0) out.problems.push(m.id + ' layer type ' + l.type);
              if (l.type === 'image' && !l.slot) out.problems.push(m.id + ' photo without slot');
            });
          }
        }
      }
    }
    return out;
  }, PHOTOS);
  h.assert(res.builds >= 6 * 4 * 3 * 3, 'built ' + res.builds);
  h.assert(!res.problems.length, res.problems.slice(0, 6).join(' | '));
  h.assert.noErrors(page);
};

cases['each maker offers 4–6 styles and square, 4:5 and 9:16'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const list = await page.evaluate(() => LE.makers.list().map((m) => ({ id: m.id, styles: m.styles.length, sizes: m.sizes.map((s) => s.w + 'x' + s.h) })));
  h.assert.equal(list.map((m) => m.id).join(','), 'quote,review,receipt,milestone,palette,film');
  list.forEach((m) => {
    h.assert(m.styles >= 4 && m.styles <= 6, m.id + ' styles');
    ['1080x1080', '1080x1350', '1080x1920'].forEach((s) => h.assert(m.sizes.indexOf(s) >= 0, m.id + ' ' + s));
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
    await page.waitForFunction(() => document.querySelectorAll('.mk-grid .mk-card').length === 6);
    h.assert(await h.noOverflow(page), vp + ' gallery overflow');
    await page.evaluate(() => { const i = document.querySelector('.mk-search input'); i.value = 'receipt'; i.dispatchEvent(new Event('input')); });
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

module.exports = cases;
