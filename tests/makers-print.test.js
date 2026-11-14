'use strict';
/* Print and identity makers: real sizes, bleed and crop marks, print sheets that register front to back, template
   fields, Create many from each maker's 12-row example list, QR codes read back per row, lint, one-undo remake and
   the form at phone sizes. Asserts on documents first; pixels only to read QR codes back. */
const path = require('path');
const fs = require('fs');

const MAKERS = ['certificate', 'businesscard', 'idbadge', 'letterhead', 'voucher', 'ticket', 'loyaltycard'];
/* maker → the fields its template page must offer Create many, and the page of the make that carries them. */
const FIELDS = {
  certificate: { keys: ['name', 'reason', 'awarded'], page: 0 },
  businesscard: { keys: ['name', 'role', 'phone', 'email'], page: 0, style: 'qr', qr: 'qr' },
  idbadge: { keys: ['name', 'role', 'id', 'photo'], page: 0, qr: 'id' },
  letterhead: { keys: ['name', 'address'], page: 0 },
  voucher: { keys: ['to', 'from', 'value', 'code'], page: 0, qr: 'code' },
  ticket: { keys: ['no', 'seat'], page: 0, qr: 'no' },
  loyaltycard: { keys: ['name', 'no'], page: 1, values: { holder: 'Amara Okafor', number: '0001' } }
};

async function studio(h, browser, base, vp, url) {
  const page = await h.open(browser, base, url || '/studio/', vp || 'desktop');
  await h.need(page, ['makers', 'design']);
  await page.waitForFunction(() => window.LEStudio && window.LEStudioMakers && window.LE.makers && window.LE.varBoot);
  await page.evaluate(() => LE.makers.ready().then(() => LE.varBoot.ready()));
  return page;
}
async function withDecoder(page) {
  await page.addScriptTag({ path: path.join(__dirname, 'lib', 'jsqr.js') });
  await page.evaluate(() => {
    window.__readQR = async (doc, edge) => {
      const c = await LE.makers.renderPage(doc, { maxEdge: edge || 1400 });
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const r = window.jsQR(d.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      return r ? r.data : null;
    };
  });
}

const cases = {};

cases['print makers are registered with physical sizes at 300 dpi and the right pixels'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate((ids) => {
    const out = {};
    ids.forEach((id) => { const m = LE.makers.get(id); out[id] = m ? m.sizes.map((s) => s.id + ':' + s.w + 'x' + s.h + (s.print ? '@' + s.print.w + 'x' + s.print.h + '/' + s.print.dpi : '')) : null; });
    out.styles = ids.map((id) => LE.makers.get(id).styles.length).join(',');
    out.kit = !!LE.makers.kit && !LE.makers.get('printkit');
    return out;
  }, MAKERS);
  h.assert(r.kit, 'the kit is loaded and is not a maker');
  h.assert.equal(r.styles, '6,8,5,5,5,4,4');
  h.assert.equal(r.certificate.join(' '), 'a4-landscape:3508x2480@297x210/300 letter-landscape:3300x2550@279.4x215.9/300 a4:2480x3508@210x297/300 letter:2550x3300@215.9x279.4/300 screen:1600x1131');
  /* 85 × 55 mm plus 3 mm bleed a side is 91 × 61 mm; 3.5 × 2 in plus 0.125 in a side is 3.75 × 2.25 in. */
  h.assert.equal(r.businesscard.slice(0, 2).join(' '), 'card-85x55:1075x720@91x61/300 card-us:1125x675@95.25x57.15/300');
  h.assert.equal(r.idbadge.slice(0, 2).join(' '), 'cr80-tall:638x1011@54x85.6/300 cr80-wide:1011x638@85.6x54/300');
  h.assert.equal(r.letterhead.join(' '), 'a4:2480x3508@210x297/300 letter:2550x3300@215.9x279.4/300');
  h.assert.equal(r.voucher.join(' '), 'dl:2480x1169@210x99/300 a6-wide:1748x1240@148x105/300 share:1600x900');
  h.assert.equal(r.ticket[0], 'ticket-140:1654x650@140x55/300');
  h.assert.equal(r.loyaltycard.join(' '), 'card-85x55:1075x720@91x61/300 card-us:1125x675@95.25x57.15/300');
  h.assert.noErrors(page);
};

cases['business cards carry bleed, crop marks and guides; sheets hold the promised count and register front to back'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const K = LE.makers.kit, mm = (n) => n / 25.4 * 300, out = {};
    const v = Object.assign({}, LE.makers.get('businesscard').sample.values); delete v.photo;
    const plain = await LE.makers.build('businesscard', v, { style: 'split', size: 'card-85x55' });
    const full = await LE.makers.build('businesscard', Object.assign({}, v, { paper: 'a4', guides: true }), { style: 'split', size: 'card-85x55' });
    const us = await LE.makers.build('businesscard', Object.assign({}, v, { paper: 'letter' }), { style: 'minimal', size: 'card-us' });
    const names = (pg) => pg.layers.filter((l) => l.type === 'group').map((l) => l.name).join('|');
    out.plainPages = plain.pages.length;
    out.plainGroups = plain.pages.map(names).join(' / ');
    out.fullGroups = full.pages.map(names).join(' / ');
    /* The colour panel runs off the page edge (into the bleed), and text stays 5 mm inside the trim. */
    const p1 = plain.pages[0], bleed = mm(3), panel = p1.layers.find((l) => l.id === 'panel');
    out.panelBleeds = panel.x === 0 && panel.y === 0 && panel.h === p1.height;
    out.textSafe = p1.layers.filter((l) => l.type === 'text').every((l) => l.x >= bleed + mm(5) - 1 && l.y >= bleed + mm(5) - 1 && l.x + l.w <= p1.width - bleed - mm(5) + 1 && l.y + l.h <= p1.height - bleed - mm(5) + 1);
    /* Crop marks: eight ticks, all outside the trim box. */
    const marks = p1.layers.filter((l) => l.groupId && /crop/.test(l.groupId));
    out.marks = marks.length;
    out.guideLayers = full.pages[0].layers.filter((l) => /^cut-outline/.test(l.id)).map((l) => Math.round(l.w / mm(1)) + 'x' + Math.round(l.h / mm(1))).join(',');
    /* Sheets: nine cards on A4 (turned), eight on Letter; each back sits where its front lands when the sheet is turned. */
    const cells = (pg) => pg.layers.filter((l) => /^(piece|card)-bg(-\d+)?-c\d+$/.test(l.id)).map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
    const fs = cells(full.pages[2]), bs = cells(full.pages[3]), W = full.pages[2].width;
    out.sheet = full.pages.slice(2).map((p) => p.width + 'x' + p.height + ':' + p.print.paper + ':' + cells(p).length).join(' ');
    out.usSheet = us.pages.slice(2).map((p) => p.print.paper + ':' + cells(p).length).join(' ');
    out.register = fs.length === bs.length && fs.every((f) => bs.some((b) => Math.abs(b.x - (W - f.x - f.w)) < 0.6 && Math.abs(b.y - f.y) < 0.6));
    out.cardPx = fs[0].w + 'x' + fs[0].h;
    out.gutter = Math.round((fs[1].x - fs[0].x - (fs[0].w - 2 * bleed)) / mm(1) * 10) / 10;
    out.notes = full.pages.slice(2).map((p) => p.layers.find((l) => /^sheet-note/.test(l.id)).text).join(' / ');
    out.sheetMarks = full.pages.slice(2).every((p) => p.layers.some((l) => l.type === 'group' && l.name === 'Cut marks'));
    /* The grids the pages promise. */
    const g = (paper, w, h, gap) => { const x = K.grid(paper, mm(w), mm(h), mm(gap), mm(14)); return x.cells.length + (x.landscape ? 'w' : 't') + x.flip[0]; };
    out.grids = [g('a4', 85, 55, 6), g('letter', 88.9, 50.8, 6.35), g('a4', 54, 85.6, 4), g('a4', 140, 55, 4), g('a4', 210, 99, 4), g('a4', 148, 105, 4)].join(' ');
    out.payload = LE.makers.cardPayload(v);
    out.problems = full.pages.concat(us.pages).reduce((a, p) => a.concat(LE.makers.check(p)), []).length;
    return out;
  });
  h.assert.equal(r.plainPages, 2, 'front and back');
  h.assert.equal(r.plainGroups, 'Crop marks / Crop marks');
  h.assert.equal(r.fullGroups, 'Crop marks|Trim and safe guides / Crop marks|Trim and safe guides / Cut marks / Cut marks');
  h.assert(r.panelBleeds, 'colour reaches the page edge');
  h.assert(r.textSafe, 'text keeps 5 mm from the trim');
  h.assert.equal(r.marks, 1, 'the crop ticks are one layer in their group');
  h.assert.equal(r.guideLayers, '85x55,79x49', 'trim and safe outlines in mm');
  h.assert.equal(r.sheet, '3508x2480:a4-landscape:9 3508x2480:a4-landscape:9');
  h.assert.equal(r.usSheet, 'letter:8 letter:8');
  h.assert(r.register, 'backs mirror fronts');
  h.assert.equal(r.cardPx, '1075x720', 'cards keep their size and bleed on the sheet');
  h.assert.equal(r.gutter, 6, 'a gutter of twice the bleed');
  h.assert(/9 to a sheet · print at 100% \(actual size\) · front \/ .*back: print on the reverse, flipping on the short edge/.test(r.notes), r.notes);
  h.assert(r.sheetMarks, 'cut marks on both sheets');
  h.assert.equal(r.grids, '9ws 8tl 9tl 4tl 1ws 2tl');
  h.assert(/^BEGIN:VCARD\nVERSION:3\.0\nN:Nair;Priya;;;\nFN:Priya Nair\nORG:Northwind Studio\nTITLE:Founder\nTEL;TYPE=CELL:\+44 20 7946 0101\nEMAIL:priya@northwind\.example\nURL:northwind\.example\nADR:;;14 Canal Street\\, Manchester M1 3HE;;;;\nEND:VCARD$/.test(r.payload), r.payload);
  h.assert.equal(r.problems, 0);
  h.assert.noErrors(page);
};

cases['badges, tickets, vouchers, letterheads and loyalty cards: guides, extra pages and sheets as promised'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  const r = await page.evaluate(async () => {
    const B = (id, extra, o) => { const v = Object.assign({}, LE.makers.get(id).sample.values, extra); delete v.photo; return LE.makers.build(id, v, o || {}); };
    const groups = (pg) => pg.layers.filter((l) => l.type === 'group').map((l) => l.name).join('|');
    const count = (pg, re) => pg.layers.filter((l) => re.test(l.id)).length;
    const badge = await B('idbadge', { back: true, paper: 'a4' });
    const ticket = await B('ticket', { paper: 'a4' });
    const dl = await B('voucher', { paper: 'a4' }), a6 = await B('voucher', { paper: 'a4' }, { size: 'a6-wide' }), share = await B('voucher', { paper: 'a4' }, { size: 'share' });
    const letter = await B('letterhead', { slip: true, envelope: true });
    const usLetter = await B('letterhead', { slip: true, envelope: true }, { size: 'letter' });
    const loyal = await Promise.all(['5', '8', '10'].map((n) => B('loyaltycard', { stamps: n, paper: 'a4' })));
    const all = [badge, ticket, dl, a6, share, letter, usLetter].concat(loyal);
    return {
      badge: badge.pages.map((p) => p.width + 'x' + p.height + ':' + groups(p)).join(' / '),
      badgeCells: badge.pages.slice(2).map((p) => count(p, /^(piece|card)-bg(-\d+)?-c\d+$/)).join(','),
      ticket: ticket.pages.map((p) => p.width + 'x' + p.height).join(' ') + ' ' + count(ticket.pages[1], /^(piece|card)-bg(-\d+)?-c\d+$/) + ' ' + count(ticket.pages[1], /^perforation(-\d+)?-c\d+$/),
      perforation: /stroke-dasharray/.test(ticket.pages[0].layers.find((l) => l.id === 'perforation').svg),
      vouchers: [dl, a6, share].map((b) => b.pages.length + ':' + (b.pages[1] ? count(b.pages[1], /^(piece|card)-bg(-\d+)?-c\d+$/) + '@' + b.pages[1].print.paper : '-')).join(' '),
      letter: letter.pages.map((p) => p.width + 'x' + p.height + ':' + (p.print ? p.print.paper + ' ' + p.print.w + 'x' + p.print.h : '')).join(' / '),
      usLetter: usLetter.pages.map((p) => p.print.paper + ' ' + p.print.w + 'x' + p.print.h).join(' / '),
      body: letter.pages[0].layers.find((l) => l.id === 'body').text.slice(0, 22),
      slots: loyal.map((b) => count(b.pages[1], /^slot-\d+$/)).join(','),
      loyalPages: loyal[2].pages.map((p) => p.width + 'x' + p.height + ':' + groups(p)).join(' / '),
      problems: all.reduce((a, b) => a.concat(...b.pages.map((p) => LE.makers.check(p))), []).map((p) => p.message).slice(0, 4).join('; ')
    };
  });
  h.assert.equal(r.badge, '638x1011:Slot punch guide / 638x1011:Slot punch guide / 2480x3508:Cut marks / 2480x3508:Cut marks');
  h.assert.equal(r.badgeCells, '9,9');
  h.assert.equal(r.ticket, '1654x650 2480x3508 4 4', 'four tickets on A4, each with its perforation');
  h.assert(r.perforation, 'the perforation is a dashed line');
  h.assert.equal(r.vouchers, '2:1@a4-landscape 2:2@a4 1:-', 'one DL or two A6 to a sheet; the share size has no sheet');
  h.assert.equal(r.letter, '2480x3508:a4 210x297 / 2480x1169:slip 210x99 / 2598x1299:envelope-dl 220x110');
  h.assert.equal(r.usLetter, 'letter 215.9x279.4 / slip 215.9x93.1 / envelope-10 241.3x104.8');
  h.assert.equal(r.body, 'Write your letter here');
  h.assert.equal(r.slots, '5,8,10');
  h.assert.equal(r.loyalPages, '1075x720:Crop marks / 1075x720:Crop marks / 3508x2480:Cut marks / 3508x2480:Cut marks');
  h.assert.equal(r.problems, '');
  h.assert.noErrors(page);
};

cases['template fields are found, the example lists match them, and a 12-row list makes 12 designs with each row in place'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await withDecoder(page);
  for (const id of MAKERS) {
    const csv = fs.readFileSync(path.join(h.ROOT, 'assets', 'samples', id + '-list.csv'), 'utf8');
    const r = await page.evaluate(async ([id, spec, csv]) => {
      const V = LE.variables, m = LE.makers.get(id);
      const v0 = Object.assign({}, m.sample.values, spec.values || {}); delete v0.photo;
      const built = await LE.makers.build(id, v0, { style: spec.style || m.styles[0].id });
      const tpl = built.pages[spec.page];
      const defs = V.definitions({ pages: [tpl] });
      const sample = LE.makers.kit.csv(LE.makers.lists[id]);
      const tbl = V.parseCSV(csv), mapping = V.automap(tbl.columns, defs);
      const rv = V.rowsToValues(tbl, mapping, defs, {});
      const out = await V.run({ doc: tpl, rows: rv.rows, output: { kind: 'jpeg', scale: 0.2, name: '{{#}}' } });
      const lint = LE.design.lint({ pages: built.pages, assets: {} }).map((w) => w.kind + ':' + (w.message || '')).filter((w) => !/^(info|note)/.test(w));
      const res = {
        keys: defs.map((d) => d.key).sort().join(','), sameCsv: sample === csv, rows: tbl.rows.length, cols: tbl.columns.join(','),
        mapped: tbl.columns.every((c, i) => Object.keys(mapping).some((k) => mapping[k] === i)), count: out.count, bad: rv.rows.filter((x) => x.problems.length).length,
        overflow: 0, texts: [], qr: [], lint: lint.slice(0, 3).join(' | '), fixed: built.pages.every((p) => !p.layers.some((l) => l.type === 'text' && /\{\{/.test(l.text) && l.overflow !== 'shrink'))
      };
      for (const i of [0, 5, 11]) {
        const f = V.fillDoc(tpl, rv.rows[i].values);
        const doc = f.doc || f.page || f;
        const want = tbl.rows[i].filter((c, ci) => !/\.jpg$/.test(c) && defs.some((d) => mapping[d.key] === ci && d.type !== 'url'));
        const have = (doc.layers || []).filter((l) => l.type === 'text').map((l) => l.text).join('\n');
        res.texts.push(want.every((c) => have.indexOf(c) >= 0));
        res.overflow += (f.problems || []).filter((p) => p.kind === 'overflow').length;
        if (spec.qr) { const d2 = JSON.parse(JSON.stringify(tpl)); d2.values = rv.rows[i].values; res.qr.push((await window.__readQR(d2, 1600)) === String(rv.rows[i].values[spec.qr])); }
      }
      if (id === 'businesscard' || id === 'idbadge') {
        const lay = V.sheetLayout(tpl, { paper: 'a4' });
        const sh = await V.run({ doc: tpl, rows: rv.rows, output: { kind: 'sheet', sheet: { paper: 'a4', marks: true } } });
        res.sheet = sh.sheets + ' sheets for ' + lay.per + ' a sheet: ' + (sh.sheets === Math.ceil(12 / lay.per));
      }
      return res;
    }, [id, FIELDS[id], csv]);
    h.assert.equal(r.keys, FIELDS[id].keys.concat(FIELDS[id].style === 'qr' ? ['qr'] : []).sort().join(','), id + ' fields');
    h.assert(r.sameCsv, id + ': the sample CSV on its page is the list the form loads');
    h.assert.equal(r.rows, 12, id + ' rows');
    h.assert(r.mapped, id + ': every column of the example list maps to a field (' + r.cols + ')');
    h.assert.equal(r.count, 12, id + ' outputs');
    h.assert.equal(r.bad, 0, id + ' rows with problems');
    h.assert(r.texts.every(Boolean), id + ': row values are drawn ' + r.texts.join(','));
    h.assert.equal(r.overflow, 0, id + ': long rows shrink to fit');
    if (FIELDS[id].qr) h.assert(r.qr.length === 3 && r.qr.every(Boolean), id + ': each row’s code reads back ' + r.qr.join(','));
    if (r.sheet) h.assert(/true$/.test(r.sheet), id + ' print sheets of the run: ' + r.sheet);
    h.assert(r.fixed, id + ': fields shrink to fit');
    h.assert.equal(r.lint, '', id + ' lint');
  }
  h.assert.noErrors(page);
};

cases['QR codes on cards, badges, vouchers and tickets read back exactly'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await withDecoder(page);
  const r = await page.evaluate(async () => {
    const out = [], S = (id) => { const v = Object.assign({}, LE.makers.get(id).sample.values); delete v.photo; return v; };
    const jobs = [
      ['businesscard', S('businesscard'), 1, LE.makers.cardPayload(S('businesscard')), ['minimal', 'dark', 'centred']],
      ['businesscard', Object.assign(S('businesscard'), { qr: 'site' }), 1, 'https://northwind.example', ['split']],
      ['businesscard', S('businesscard'), 0, LE.makers.cardPayload(S('businesscard')), ['qr']],
      ['idbadge', S('idbadge'), 0, 'NW-00412', null], ['voucher', S('voucher'), 0, 'GV-1001', null], ['ticket', S('ticket'), 0, 'A-0001', null]
    ];
    for (const [id, values, pi, want, styles] of jobs) {
      const m = LE.makers.get(id);
      for (const st of (styles || m.styles.map((s) => s.id))) for (const sz of m.sizes) {
        const b = await LE.makers.build(id, values, { style: st, size: sz.id });
        const pg = b.pages[pi], q = pg.layers.find((l) => /^qr(-\d+)?$/.test(l.id));
        out.push({ key: id + '/' + st + '/' + sz.id, ok: (await window.__readQR(pg)) === want, bound: !!(q && q.bind && q.bind.content), mm: q ? Math.round(q.w / 300 * 25.4 * (sz.print ? 1 : 0)) : 0, print: !!sz.print });
      }
    }
    out.push({ key: 'no code', ok: (await LE.makers.build('businesscard', Object.assign(S('businesscard'), { qr: 'none' }), {})).pages[1].layers.every((l) => !/^qr/.test(l.id)), bound: true, mm: 99 });
    return out;
  });
  r.forEach((x) => {
    h.assert(x.ok, x.key + ' reads back');
    h.assert(x.bound, x.key + ' is bound to a field');
    if (x.print) h.assert(x.mm >= 11, x.key + ' code is ' + x.mm + ' mm');
  });
  h.assert.noErrors(page);
};

cases['Make one for each row of a list: makes the design, opens Create many with the example list matched'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  for (const [id, pageIndex, pages] of [['certificate', 0, 1], ['loyaltycard', 1, 2]]) {
    await page.evaluate((id) => LEStudioMakers.open(id), id);
    await page.waitForFunction(() => document.querySelector('.mk-foot .mk-many'));
    h.assert.equal(await page.evaluate(() => document.querySelector('.mk-foot .mk-many').textContent), 'Make one for each row of a list');
    const before = await page.evaluate(() => (LEStudio.S.project ? LEStudio.S.project.pages.length : 0));
    await page.click('.mk-foot .mk-many');
    await page.waitForFunction(() => { const b = window.LEStudioVariables && LEStudioVariables.bulk(); return b && b.table && b.step === 'match' && document.querySelector('.vx-map'); }, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const c = LEStudio, b = LEStudioVariables.bulk(); c.syncProject();
      const d = c.scene.toJSON();
      return { maker: d.maker && d.maker.id, active: c.S.project.activePage, pages: c.S.project.pages.length, rows: b.table.rows.length, panel: c.S.panel, values: d.values,
        mapped: Object.keys(b.mapping).filter((k) => b.mapping[k] >= 0).sort().join(','), selects: [...document.querySelectorAll('.vx-map select')].map((s) => s.options[s.selectedIndex].textContent.split(' — ')[0]).join(','),
        form: !!document.querySelector('.mk-sheet') };
    });
    h.assert.equal(r.maker, id);
    h.assert.equal(r.panel, 'bulk');
    h.assert(!r.form, 'the form closed: the person is in the editor');
    h.assert.equal(r.pages - before, before ? pages + 0 : pages, id + ' pages added');
    h.assert.equal(r.rows, 12);
    if (id === 'certificate') { h.assert.equal(r.mapped, 'awarded,name,reason'); h.assert.equal(r.selects, 'name,reason,awarded'); h.assert.equal(r.values.name, 'Amara Okafor'); }
    else { h.assert.equal(r.mapped, 'name,no'); h.assert.equal(r.values.name, 'Amara Okafor', 'an empty holder took the first example row, so the back has its fields'); }
    h.assert.equal(r.active, (before ? before : 0) + pageIndex, id + ': Create many is on the page with the fields');
  }
  h.assert.noErrors(page);
};

cases['a multi-page make lands in the editor, Edit details remakes it in one undo step, and print pages export at their paper size'] = async ({ browser, base, h }) => {
  const page = await studio(h, browser, base);
  await h.need(page, ['export']);
  await page.evaluate(() => LEStudioMakers.open('businesscard'));
  await page.waitForFunction(() => document.querySelector('.mk-sheet .mk-make') && document.querySelector('.mk-pages'));
  h.assert.equal(await page.evaluate(() => document.querySelector('.mk-pages').textContent.trim().slice(0, 7)), '2 pages');
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => LEStudio.S.project && LEStudio.S.project.pages.length === 2 && LEStudio.scene.toJSON().maker);
  const before = await page.evaluate(() => { LEStudio.syncProject(); const p = LEStudio.S.project; return { pages: p.pages.map((x) => x.maker.id + ':' + x.width + 'x' + x.height + ':' + x.print.w), active: p.activePage, layers: JSON.stringify(LEStudio.scene.toJSON().layers), size: LEStudioExport.print.pageSize(LEStudio.scene.toJSON()) }; });
  h.assert.equal(before.pages.join(' '), 'businesscard:1075x720:91 businesscard:1075x720:91');
  h.assert.equal(before.active, 0, 'the front is shown');
  /* 91 × 61 mm in points. */
  const pt = Object.values(before.size).filter((n) => typeof n === 'number');
  h.assert(Math.abs(pt[0] - 257.95) < 0.2 && Math.abs(pt[1] - 172.91) < 0.2, 'PDF page is the card with its bleed: ' + JSON.stringify(before.size));
  await page.evaluate(() => LEStudioMakers.edit());
  await page.waitForFunction(() => LEStudioMakers.form());
  await page.evaluate(() => { const F = LEStudioMakers.form(); F.values.name = 'Dev Patel'; F.values.paper = 'a4'; });
  await page.evaluate(() => LEStudioMakers.make());
  await page.waitForFunction(() => LEStudio.S.project.pages.length === 4);
  const after = await page.evaluate(() => { LEStudio.syncProject(); const p = LEStudio.S.project; return { name: LEStudio.scene.toJSON().values.name, sheet: p.pages[2].print.paper, filled: LE.makers.check(p.pages[0]).length }; });
  h.assert.equal(after.name, 'Dev Patel');
  h.assert.equal(after.sheet, 'a4-landscape');
  await page.evaluate(() => LEStudio.scene.undo());
  await page.waitForFunction(() => LEStudio.S.project.pages.length === 2);
  h.assert.equal(await page.evaluate(() => JSON.stringify(LEStudio.scene.toJSON().layers)), before.layers, 'one undo restores the front, and the sheets are gone');
  h.assert.noErrors(page);
};

/* The studio's own chips are 40 px tall (the measure tests/makers.test.js uses); the buttons this set adds are 44 px. */
cases['forms at 390 and 360 px: no sideways scroll, no small targets, the list button 44 px and in reach'] = async ({ browser, base, h }) => {
  for (const vp of ['phone', 'small']) {
    const page = await studio(h, browser, base, vp);
    for (const id of MAKERS) {
      await page.evaluate((id) => LEStudioMakers.open(id), id);
      await page.waitForFunction(() => document.querySelector('.mk-render') && document.querySelector('.mk-foot .mk-many'));
      h.assert(await h.noOverflow(page), vp + ' ' + id + ' form overflow');
      const r = await page.evaluate(() => {
        const sheet = document.querySelector('.mk-sheet'), W = window.innerWidth;
        const small = [...sheet.querySelectorAll('button, input:not([type=checkbox]):not([type=file]):not([type=color]), select')].filter((n) => n.offsetParent && n.getBoundingClientRect().height < 40).map((n) => (n.className || n.tagName) + ':' + Math.round(n.getBoundingClientRect().height));
        const many = sheet.querySelector('.mk-many').getBoundingClientRect(), make = sheet.querySelector('.mk-make').getBoundingClientRect();
        const wide = [...sheet.querySelectorAll('.mk-form *')].filter((n) => n.getBoundingClientRect().right > W + 1 && !n.closest('.is-scroll')).length;
        return { small: small.slice(0, 4).join(','), many: many.height >= 44 && many.left >= 0 && many.right <= W && many.bottom <= window.innerHeight, make: make.height >= 44 && make.right <= W, wide };
      });
      h.assert.equal(r.small, '', vp + ' ' + id + ' small targets');
      h.assert(r.many && r.make, vp + ' ' + id + ': both buttons are on screen and 44 px tall');
      h.assert.equal(r.wide, 0, vp + ' ' + id + ': nothing runs off the side');
      await page.evaluate(() => LEStudioMakers.close());
    }
    h.assert.noErrors(page);
  }
};

module.exports = cases;
