'use strict';
/* Live link: a design file on disk ↔ an open studio tab, through `localeditor link`. The tab is a real studio page
   in the test browser; the file is changed the way an agent would (plain writes, atomic renames). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'tools', 'le-cli', 'bin', 'localeditor.js');
const cases = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DESIGN = () => ({ format: 'localeditor-design', version: 1, name: 'Linked', pages: [{ id: 'p', width: 600, height: 400, background: '#ffffff', layers: [
  { id: 'a', type: 'shape', shape: 'rectangle', fill: '#ff0000', x: 20, y: 20, w: 100, h: 100 },
  { id: 'b', type: 'text', text: 'Hello', font: 'Inter', size: 40, color: '#17131F', x: 200, y: 40, w: 300 }
] }] });

async function start(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-link-' + tag + '-'));
  fs.mkdirSync(path.join(dir, 'tmp'));
  const file = path.join(dir, 'd.ledesign.json');
  fs.writeFileSync(file, JSON.stringify(DESIGN(), null, 2));
  const proc = spawn(process.execPath, [BIN, 'link', 'd.ledesign.json', '--no-open', '--json'], {
    cwd: dir, env: Object.assign({}, process.env, { LE_BROWSER: require('playwright').chromium.executablePath(), TMPDIR: path.join(dir, 'tmp') }), stdio: ['pipe', 'pipe', 'pipe']
  });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  const info = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('link did not start: ' + err)), 40000);
    proc.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); try { resolve(JSON.parse(buf.slice(0, i))); } catch (e) { reject(new Error(buf)); } } });
    proc.on('close', () => reject(new Error('link exited: ' + err)));
  });
  const stop = async () => { if (proc.exitCode == null) { proc.kill('SIGTERM'); await new Promise((r) => { const t = setTimeout(r, 10000); proc.on('close', () => { clearTimeout(t); r(); }); }); } };
  return { dir, file, info, proc, stop, status: () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'd.le', 'status.json'), 'utf8')); } catch (e) { return null; } } };
}
async function tab(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.LE && LE.link && LE.link.client && LE.link.client.ready && window.LEStudio.scene.layers().length === 2, null, { timeout: 30000 });
  return page;
}
const layer = (page, id) => page.evaluate((i) => (window.LEStudio.scene.layers().find((l) => l.id === i) || null), id);
const readFile = (s) => JSON.parse(fs.readFileSync(s.file, 'utf8'));
const L = (doc, id) => doc.pages[0].layers.find((l) => l.id === id);
async function until(fn, ms, what) {
  const end = Date.now() + (ms || 15000);
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(100); }
  throw new Error('Timed out waiting for ' + (what || 'condition') + (last ? ' (last: ' + JSON.stringify(last).slice(0, 200) + ')' : ''));
}
/* An agent-style edit: read the file, change it, write it back (optionally with write-then-rename, as editors do). */
function agentEdit(s, fn, atomic) {
  const d = readFile(s);
  fn(d);
  const text = JSON.stringify(d, null, 2);
  if (atomic) { const tmp = s.file + '.tmp~'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, s.file); } else fs.writeFileSync(s.file, text);
}

cases['file change → the tab updates as one undo step; status.json and preview update'] = async ({ browser, h }) => {
  const s = await start('a2t');
  try {
    h.assert(s.info.url.indexOf('/studio/?link=') > 0 && /#lt=/.test(s.info.url), 'link URL: ' + s.info.url);
    const page = await tab(browser, s.info.url);
    h.assert(!/lt=/.test(await page.evaluate(() => location.href)), 'the token is removed from the address bar');
    await until(() => s.status() && s.status().ok, 15000, 'first status.json');
    const prev = path.join(s.dir, 'd.le', 'preview-0.png');
    await until(() => fs.existsSync(prev), 15000, 'first preview');
    const m0 = fs.statSync(prev).mtimeMs;
    const rev0 = s.status().rev;
    agentEdit(s, (d) => { L(d, 'a').x = 300; L(d, 'a').fill = '#0000ff'; }, true);
    await until(async () => (await layer(page, 'a')).x === 300, 15000, 'tab shows x 300');
    h.assert.equal((await layer(page, 'a')).fill.color.toLowerCase(), '#0000ff', 'fill updated too');
    await until(() => s.status().rev !== rev0 && fs.statSync(prev).mtimeMs > m0, 15000, 'status.json rev and preview updated');
    h.assert(s.status().ok && s.status().tabs === 1, 'status says ok, one tab');
    h.assert.equal(h.imageInfo(fs.readFileSync(prev)).w, 600, 'preview at page size');
    await page.evaluate(() => window.LEStudio.scene.undo());
    let a = await layer(page, 'a');
    h.assert(a.x === 20 && a.fill.color.toLowerCase() === '#ff0000', 'one undo step takes the whole agent change back: ' + JSON.stringify(a));
    await page.evaluate(() => window.LEStudio.scene.redo());
    a = await layer(page, 'a');
    h.assert.equal(a.x, 300, 'redo');
    h.assert.equal(page.errors.length, 0, 'console clean: ' + page.errors.join(' | '));
  } finally { await s.stop(); }
};

cases['tab edit → the file changes (normalised, atomic); invalid file is not applied and errors are written'] = async ({ browser, h }) => {
  const s = await start('t2a');
  try {
    const page = await tab(browser, s.info.url);
    await page.evaluate(() => window.LEStudio.patch('b', { text: 'Person typed this' }));
    await until(() => L(readFile(s), 'b').text === 'Person typed this', 15000, 'file has the edit');
    const text = fs.readFileSync(s.file, 'utf8');
    h.assert(/^\{\n {2}"\$schema"/.test(text), 'written in the normalised long form');
    h.assert(!fs.readdirSync(s.dir).some((f) => /\.tmp$/.test(f)), 'no temp files left behind');
    fs.writeFileSync(s.file, '{ "format": "localeditor-design", "version": 1, "pages": [ { "layers": [ { "id": "x", "type": "blob" } ] } ] }');
    await until(() => s.status() && s.status().ok === false && s.status().errors[0].path === '/pages/0/layers/0/type', 15000, 'status.json reports the error');
    const st = s.status();
    h.assert(st.errors[0].path === '/pages/0/layers/0/type', 'error with a JSON pointer: ' + JSON.stringify(st.errors));
    await sleep(500);
    h.assert.equal((await layer(page, 'b')).text, 'Person typed this', 'the last good state stays in the tab');
    h.assert(/errors/.test(await page.textContent('#le-link-chip')), 'the tab shows the problem');
    fs.writeFileSync(s.file, JSON.stringify(DESIGN(), null, 2));
    await until(async () => (await layer(page, 'b')).text === 'Hello', 15000, 'a fixed file applies again');
    await until(() => s.status().ok === true, 10000, 'status ok again');
  } finally { await s.stop(); }
};

cases['simultaneous edits to different layers merge; same layer → the person wins and the agent change is reported'] = async ({ browser, h }) => {
  const s = await start('merge');
  try {
    const page = await tab(browser, s.info.url);
    /* Different layers: the person moves "a", the agent rewrites "b" before the tab has saved. */
    await page.evaluate(() => window.LEStudio.patch('a', { x: 222 }));
    agentEdit(s, (d) => { L(d, 'b').text = 'Agent wrote this'; });
    await until(() => { const d = readFile(s); return L(d, 'a').x === 222 && L(d, 'b').text === 'Agent wrote this'; }, 20000, 'file has both edits');
    await until(async () => (await layer(page, 'b')).text === 'Agent wrote this' && (await layer(page, 'a')).x === 222, 15000, 'tab has both edits');
    await sleep(800);
    /* Same layer: both move "a". */
    await page.evaluate(() => window.LEStudio.patch('a', { x: 333 }));
    agentEdit(s, (d) => { L(d, 'a').x = 444; });
    await until(() => L(readFile(s), 'a').x === 333 && s.status() && s.status().conflicts && s.status().conflicts.length, 20000, 'person wins, conflict reported');
    const c = s.status().conflicts.find((x) => x.layer === 'a');
    h.assert(c && c.kept === 'person' && c.agent && c.agent.x === 444, 'the agent version is in status.json: ' + JSON.stringify(s.status().conflicts));
    await sleep(800);
    h.assert.equal((await layer(page, 'a')).x, 333, 'the tab keeps the person\'s value');
  } finally { await s.stop(); }
};

cases['notes, two tabs, tab closing, file deleted and replaced, server stopping'] = async ({ browser, h }) => {
  const s = await start('life');
  try {
    const one = await tab(browser, s.info.url);
    const two = await tab(browser, s.info.url);
    await until(() => s.status() && s.status().tabs === 2, 10000, 'two tabs connected');
    await one.evaluate(() => window.LEStudio.patch('b', { text: 'From tab one' }));
    await until(async () => (await layer(two, 'b')).text === 'From tab one', 15000, 'tab two follows tab one');
    await one.evaluate(() => LE.link.client.addNote('Make this warmer', 'a'));
    await until(() => (readFile(s).notes || []).some((n) => n.text === 'Make this warmer' && n.layer === 'a' && n.by === 'person' && n.status === 'open'), 10000, 'note in the file');
    h.assert.equal(s.status().notes.open, 1, 'status.json counts open notes');
    await two.context().close();
    await until(() => s.status().tabs === 1, 10000, 'closing a tab is noticed');
    fs.unlinkSync(s.file);
    await until(() => s.status().ok === false && /deleted/.test(s.status().errors[0].message), 10000, 'deletion reported');
    await until(async () => /deleted/.test(await one.textContent('#le-link-chip')), 10000, 'the tab says the file was deleted');
    h.assert.equal((await layer(one, 'b')).text, 'From tab one', 'the design stays open in the tab');
    const d = DESIGN(); d.pages[0].layers[0].x = 77;
    const tmp = s.file + '.swp'; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, s.file);
    await until(async () => (await layer(one, 'a')).x === 77, 15000, 'the replaced file applies');
    const procs = () => { try { return execFileSync('pgrep', ['-f', path.join(s.dir, 'tmp', 'localeditor-engine-')]).toString().trim().split('\n').filter(Boolean); } catch (e) { return []; } };
    h.assert(procs().length > 0, 'engine running');
    await s.stop();
    /* The goodbye event normally arrives ("stopped"); when the stream is mid-reconnect it is missed, and the tab says
       "not reachable" after four failed retries (about 12 s). Either tells the person the same thing. */
    await until(async () => /stopped|not reachable/.test(await one.textContent('#le-link-chip')), 25000, 'the tab says the server stopped');
    await until(() => procs().length === 0, 10000, 'engine gone after SIGTERM');
    h.assert.equal(fs.readdirSync(path.join(s.dir, 'tmp')).filter((f) => f.startsWith('localeditor-engine-')).length, 0, 'temp profile removed');
    h.assert.equal(s.status().linked, false, 'status.json says the link ended');
    await one.evaluate(() => window.LEStudio.patch('b', { text: 'Offline edit' }));
    h.assert.equal((await layer(one, 'b')).text, 'Offline edit', 'the tab keeps working without the server');
  } finally { await s.stop(); }
};

/* ---------- consent: a tool asks to show another design in a tab that is already open ---------- */
const OTHER = () => { const d = DESIGN(); d.name = 'Other'; d.pages[0].layers[1].text = 'Other file'; return d; };
/* The tool's side: POST <api>attach and wait for the person's answer. → { status, body } */
const attach = (s, file, extra) => fetch(s.info.api + 'attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ file, tool: 'Test tool' }, extra || {})) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
/* The server sees the tab (its event stream is connected) on the link for this file. */
const seen = (s, file) => until(async () => (await (await fetch(s.info.api + 'links')).json()).links.some((l) => l.file === file && l.tabs > 0), 15000, 'the tab is connected on ' + file);
const sheet = (page) => page.waitForSelector('#sx-modal .sxa-ask [data-a="once"]', { timeout: 15000 });
const noSheet = (page) => page.waitForFunction(() => !document.querySelector('#sx-modal .sxa-ask [data-a]'), null, { timeout: 15000 });

cases['consent: an open tab is asked before a tool switches it; allow once asks again, allow for this session does not; changes made while waiting are kept'] = async ({ browser, h }) => {
  const s = await start('consent');
  try {
    const other = path.join(s.dir, 'e.ledesign.json');
    fs.writeFileSync(other, JSON.stringify(OTHER(), null, 2));
    const page = await tab(browser, s.info.url);
    await seen(s, 'd.ledesign.json');
    const waiting = attach(s, 'e.ledesign.json');
    await sheet(page);
    const text = await page.textContent('#sx-modal');
    h.assert(/Test tool/.test(text) && /e\.ledesign\.json/.test(text) && text.includes(fs.realpathSync(s.dir)), 'the sheet names the tool, the file and the folder: ' + text.slice(0, 300));
    h.assert.equal((await page.$$eval('#sx-modal [data-a]', (b) => b.map((x) => x.textContent))).join('|'), 'Refuse|Allow for this session|Allow once');
    await page.waitForSelector('.sxa-bar [data-rid]');
    h.assert(/Test tool is asking to use this tab/.test(await page.textContent('.sxa-bar')), 'the request shows in the banner');
    /* The tool keeps working while it waits: its change to the file is held, not dropped. */
    const d = OTHER(); d.pages[0].layers[1].text = 'Written while waiting';
    fs.writeFileSync(other, JSON.stringify(d, null, 2));
    await sleep(800);
    h.assert.equal((await layer(page, 'b')).text, 'Hello', 'nothing changes in the tab before the person answers');
    await page.click('#sx-modal [data-a="once"]');
    const r = await waiting;
    h.assert(r.status === 200 && r.body.ok && r.body.consent === 'once' && r.body.file === 'e.ledesign.json', JSON.stringify(r.body));
    await until(async () => (await layer(page, 'b')).text === 'Written while waiting', 20000, 'the tab shows the other file with the change made while waiting');
    await page.waitForFunction(() => !document.querySelector('.sxa-bar [data-rid]'));
    h.assert(new URL(page.url()).searchParams.get('link') === r.body.link && !/lt=/.test(page.url()), 'the address names the new link, without the token');
    h.assert(await page.evaluate(() => Object.keys(sessionStorage).concat(Object.keys(localStorage)).every((k) => !/consent|allow/i.test(k))), 'no allowance is stored');
    /* The new link is live both ways. */
    await until(() => page.evaluate(() => !!(LE.link.client && LE.link.client.ready)), 15000, 'new link ready');
    const d2 = JSON.parse(fs.readFileSync(other, 'utf8')); d2.pages[0].layers[0].x = 66; fs.writeFileSync(other, JSON.stringify(d2, null, 2));
    await until(async () => (await layer(page, 'a')).x === 66, 15000, 'file → tab on the new link');
    await until(() => page.evaluate(() => LE.link.client.applying === 0 && /Updated|Up to date|Linked/.test(document.getElementById('le-link-chip').textContent)), 15000, 'the file change has settled');
    await page.evaluate(() => window.LEStudio.patch('b', { text: 'From the tab' }));
    await until(() => JSON.parse(fs.readFileSync(other, 'utf8')).pages[0].layers[1].text === 'From the tab', 15000, 'tab → file on the new link');
    h.assert.equal(L(readFile(s), 'b').text, 'Hello', 'the first file was not touched');

    /* "Once" was once: the next request asks again. "For this session" then covers the one after. */
    await seen(s, 'e.ledesign.json');
    const back = attach(s, 'd.ledesign.json');
    await sheet(page);
    await page.click('#sx-modal [data-a="session"]');
    const r2 = await back;
    h.assert(r2.body.ok && r2.body.consent === 'session', JSON.stringify(r2.body));
    await until(async () => (await layer(page, 'b')).text === 'Hello', 20000, 'back on the first file');
    await seen(s, 'd.ledesign.json');
    const r3 = await attach(s, 'e.ledesign.json');
    h.assert(r3.body.ok && r3.body.consent === 'session', 'allowed for the session: no sheet. ' + JSON.stringify(r3.body));
    await until(async () => (await layer(page, 'b')).text === 'From the tab', 20000, 'switched without asking');
    h.assert(!(await page.$('#sx-modal .sxa-ask [data-a]')), 'no sheet was shown');
    await seen(s, 'e.ledesign.json');
    const again = await attach(s, 'e.ledesign.json');
    h.assert(again.body.ok && again.body.consent === 'linked', 'a design that is already open needs no question: ' + JSON.stringify(again.body));
    /* A reload forgets the session allowance. */
    await page.reload({ waitUntil: 'load' });
    await until(() => page.evaluate(() => !!(window.LE && LE.link && LE.link.client && LE.link.client.ready)), 30000, 'reloaded tab linked again');
    await seen(s, 'e.ledesign.json');
    const after = attach(s, 'd.ledesign.json', { timeout: 20 });
    await sheet(page);
    await page.click('#sx-modal [data-a="refuse"]');
    h.assert.equal((await after).body.code, 'consent-refused', 'after a reload the person is asked again');
    h.assert(!page.errors.length, page.errors.join(' | '));
  } finally { await s.stop(); }
};

cases['consent: refuse, time out, cancel from the banner, tab closed while waiting, no tab at all: each has its own code'] = async ({ browser, h }) => {
  const s = await start('refuse');
  try {
    fs.writeFileSync(path.join(s.dir, 'e.ledesign.json'), JSON.stringify(OTHER(), null, 2));
    const none = await attach(s, 'e.ledesign.json');
    h.assert(none.status === 409 && none.body.code === 'consent-no-tab' && /\/studio\/\?link=/.test(none.body.url), 'no tab: ' + JSON.stringify(none.body));
    const page = await tab(browser, s.info.url);
    await seen(s, 'd.ledesign.json');

    const refused = attach(s, 'e.ledesign.json');
    await sheet(page);
    await page.click('#sx-modal [data-a="refuse"]');
    const r1 = await refused;
    h.assert(r1.status === 403 && r1.body.ok === false && r1.body.code === 'consent-refused', JSON.stringify(r1.body));
    h.assert.equal((await layer(page, 'b')).text, 'Hello', 'a refused request changes nothing');
    await noSheet(page);

    const slow = attach(s, 'e.ledesign.json', { timeout: 2 });
    await sheet(page);
    const r2 = await slow;
    h.assert(r2.status === 504 && r2.body.code === 'consent-timeout', JSON.stringify(r2.body));
    await noSheet(page);
    await page.waitForFunction(() => !document.querySelector('.sxa-bar [data-rid]'));

    const cancelled = attach(s, 'e.ledesign.json');
    await sheet(page);
    await page.keyboard.press('Escape');
    await noSheet(page);
    await page.waitForSelector('.sxa-bar [data-rid]');
    h.assert(/Cancel request/.test(await page.textContent('.sxa-bar')), 'closing the sheet leaves the request in the banner');
    await page.click('.sxa-bar [data-act="link-review"]');
    await sheet(page);
    await page.keyboard.press('Escape');
    await page.click('.sxa-bar [data-act="link-cancel"]');
    const r3 = await cancelled;
    h.assert(r3.status === 403 && r3.body.code === 'consent-cancelled', JSON.stringify(r3.body));
    await page.waitForFunction(() => !document.querySelector('.sxa-bar [data-rid]'));
    h.assert(!page.errors.length, page.errors.join(' | '));

    /* The command line waits the same way; closing the tab while it waits ends it with its own code. */
    const cli = spawn(process.execPath, [BIN, 'link', 'e.ledesign.json', '--attach', s.info.api, '--timeout', '40', '--json'], { cwd: s.dir, env: Object.assign({}, process.env, { TMPDIR: path.join(s.dir, 'tmp') }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    cli.stdout.on('data', (d) => { out += d; });
    const exited = new Promise((r) => cli.on('close', r));
    await sheet(page);
    await page.context().close();
    const code = await exited;
    h.assert(code === 1 && JSON.parse(out).code === 'consent-tab-closed', 'exit ' + code + ': ' + out);
    h.assert.equal(L(readFile(s), 'b').text, 'Hello', 'the file was not touched');
  } finally { await s.stop(); }
};

module.exports = cases;
