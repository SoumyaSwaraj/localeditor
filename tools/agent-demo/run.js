#!/usr/bin/env node
/* Plays the part of a coding agent through each agent-mode channel, with Playwright, and saves screenshots of the
   watching experience so the pacing and clarity can be reviewed.

     node tools/agent-demo/run.js [outDir]        (default: $AGENT_DEMO_OUT or <tmp>/localeditor-agent-demo)

   Channels:
     1. evaluate — window.LEAgent in the page (Claude Code + Playwright MCP, Cursor's browser, DevTools MCP)
     2. console  — only click, type and read: the "Agent command" textbox, the Run button, the "Agent result" region
     3. link     — only open a URL: /studio/?agent=1#ops=…, the person confirms
   The "person" is played too: turning agent mode on, pinning a note, pausing, editing mid-batch. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('../../tests/lib/harness');

const OUT = path.resolve(process.argv[2] || process.env.AGENT_DEMO_OUT || path.join(os.tmpdir(), 'localeditor-agent-demo'));
fs.mkdirSync(OUT, { recursive: true });
const shots = [];
const log = (...a) => console.log('[demo]', ...a);
async function shot(page, name, note) {
  const file = path.join(OUT, String(shots.length + 1).padStart(2, '0') + '-' + name + '.png');
  await page.screenshot({ path: file });
  shots.push({ file, note });
  log('screenshot', path.basename(file), '—', note);
}
function check(cond, msg) { if (!cond) throw new Error('Demo check failed: ' + msg); }

/* A small "photo" made on the Node side as a data URI is not possible without a canvas, so the page draws one. */
const PHOTO = () => {
  const c = document.createElement('canvas'); c.width = 960; c.height = 600;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 960, 600); g.addColorStop(0, '#F2994A'); g.addColorStop(0.55, '#EB5757'); g.addColorStop(1, '#2F2A5B');
  x.fillStyle = g; x.fillRect(0, 0, 960, 600);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(700, 190, 70, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1E1B3A'; x.beginPath(); x.moveTo(0, 600); x.lineTo(260, 330); x.lineTo(470, 520); x.lineTo(640, 380); x.lineTo(960, 600); x.fill();
  return c.toDataURL('image/jpeg', 0.85);
};

async function evaluateChannel(browser, base) {
  log('— channel 1: evaluate (window.LEAgent) —');
  const page = await h.open(browser, base, '/studio/?agent=1', 'desktop');
  await page.waitForFunction(() => window.LEAgent && LEAgent._internal.A.ready);
  await page.waitForSelector('.sxa-ask');
  await shot(page, 'consent', 'The person opens /studio/?agent=1 and sees the one-time explanation.');
  await page.click('.sxa-ask [data-yes]');
  const A = (fn, arg) => page.evaluate(fn, arg);
  const begin = await A(() => LEAgent.begin({ name: 'Claude', task: 'Make a launch post for localeditor v2' }));
  check(begin.ok, 'begin');
  await A(() => LEAgent._person.setSpeed('slow'));
  const help = await A(() => LEAgent.help());
  check(help.operations.add, 'help');
  const photo = await page.evaluate(PHOTO);

  /* Step 1: canvas size, background and headline. Screenshot while the pointer is on its way. */
  let p = A(() => LEAgent.apply([
    { op: 'page.resize', width: 1080, height: 1350 },
    { op: 'page.background', background: '#0F1B3D' },
    { op: 'rename', name: 'Launch post' },
    { op: 'add', layer: { id: 'headline', type: 'text', text: 'LocalEditor v2 is here', font: 'Anton', size: 220, color: '#FFFFFF', x: 'center', y: 90, w: '86%', h: 330, fit: 'shrink', align: 'center' } }
  ], { label: 'Page, background and headline' }));
  await page.waitForTimeout(1500);
  await shot(page, 'pointer-headline', 'Watch slowly: the labelled pointer glides to the new headline and says what it is doing.');
  let r = await p;
  check(r.ok, 'step 1 ' + JSON.stringify(r.errors));

  /* Step 2: photo slot filled with an image, and a subtitle that is too faint (check() will catch it). */
  p = A((src) => LEAgent.apply([
    { op: 'add', layer: { id: 'hero', type: 'image', slot: true, x: 'center', y: 470, w: '84%', h: 520, radius: 28 } },
    { op: 'image.fill', id: 'hero', src },
    { op: 'add', layer: { id: 'subtitle', type: 'text', text: 'Private, offline design — now with agent mode', font: 'Inter', weight: 600, size: 44, color: '#2A3F7A', x: 'center', y: 1040, w: '84%', align: 'center' } }
  ], { label: 'Photo and subtitle' }), photo);
  await page.waitForTimeout(1200);
  await shot(page, 'pointer-photo', 'The photo fades in where its slot is, with the step named under the pointer.');
  r = await p;
  check(r.ok, 'step 2 ' + JSON.stringify(r.errors));

  /* Step 3: badge and icon. */
  p = A(() => LEAgent.apply([
    { op: 'add', layer: { id: 'badge', type: 'shape', shape: 'burst', fill: '#E0B354', x: 820, y: 400, w: 210, h: 210, rotation: 12 } },
    { op: 'add', layer: { id: 'badge-text', type: 'text', text: 'NEW', font: 'Anton', size: 64, color: '#2A1F0A', x: 845, y: 470, w: 160, align: 'center', rotation: 12 } },
    { op: 'add', layer: { id: 'icon', type: 'icon', icon: 'lucide:sparkles', color: '#E0B354', x: 'center', y: 1180, w: 96 } },
    { op: 'group', ids: ['badge', 'badge-text'], groupId: 'badge-group', name: 'New badge' }
  ], { label: 'Badge and icon' }));
  await page.waitForTimeout(1100);
  await shot(page, 'pointer-badge', 'Each new layer is visited in turn; the activity feed on the left grows with plain-language entries.');
  r = await p;
  check(r.ok, 'step 3 ' + JSON.stringify(r.errors));

  /* Self-check loop. */
  const c1 = await A(() => LEAgent.check());
  log('check() found', c1.count, 'problem(s):', c1.problems.map((x) => x.kind + ' ' + x.layer).join(', '));
  check(c1.problems.some((x) => x.kind === 'low-contrast' && x.layer === 'subtitle'), 'the faint subtitle is reported');
  await A(() => LEAgent._person.setSpeed('normal'));
  r = await A((ps) => LEAgent.apply(ps.map((x) => x.fix).filter(Boolean), { label: 'Fix contrast' }), c1.problems);
  check(r.ok, 'fixes');
  const c2 = await A(() => LEAgent.check());
  check(c2.clean, 'clean after fixes: ' + JSON.stringify(c2.problems));

  /* The person pins a note on the headline. */
  await page.click('.sxa-bar [data-act="more"]');
  await page.click('.sxa-bar [data-act="pinnote"]');
  const pt = await page.evaluate(() => { const b = LEStudio.scene.screenRect('headline'); return { x: b.left + b.width * 0.7, y: b.top + b.height / 2 }; });
  await page.mouse.click(pt.x, pt.y);
  await page.fill('#sxa-note-text', 'Make the headline warmer — gold, not white');
  await shot(page, 'person-note', 'The person taps the headline and writes a note for the agent.');
  await page.click('.sxa-noteedit button[type="submit"]');
  await page.click('.sxa-bar [data-act="more"]');
  await page.waitForTimeout(400);
  await shot(page, 'note-pinned', 'The note is pinned on the canvas and listed for the agent.');

  /* The agent sees it in pending.notes on its next call, acts and replies. */
  const st = await A(() => LEAgent.state());
  const note = st.pending.notes[0];
  check(note && /warmer/.test(note.text) && note.layer === 'headline', 'note delivered: ' + JSON.stringify(st.pending));
  await A(() => LEAgent._person.setSpeed('slow'));
  p = A(() => LEAgent.apply([{ op: 'update', id: 'headline', set: { color: '#F3CC7C' } }], { label: 'Warmer headline (your note)' }));
  await page.waitForTimeout(900);
  await shot(page, 'restyle-pulse', 'A restyled layer pulses where it is; nothing moves.');
  await p;
  await A((id) => LEAgent.resolveNote(id, 'Changed the headline to gold.'), note.id);

  /* The person grabs the canvas while the agent has work queued: the agent waits. */
  p = A(() => LEAgent.apply([{ op: 'update', id: 'badge-group', set: { x: 40, y: 380 } }], { label: 'Move the badge left' }));
  const p2 = A(() => LEAgent.apply([{ op: 'update', id: 'icon', set: { w: 120 } }], { label: 'Bigger icon' }));
  await page.waitForTimeout(500);
  const sr = await page.evaluate(() => { const r2 = LEStudio.E.sceneEl.getBoundingClientRect(); return { x: r2.left + 30, y: r2.top + 30 }; });
  await page.mouse.move(sr.x, sr.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500);
  await shot(page, 'person-interrupts', 'The person clicks while a batch is queued: the agent pauses and the banner says it is waiting.');
  const q = await p2;
  check(q.queued || q.ok, 'second batch queued or applied');
  await page.click('.sxa-bar [data-act="resume"]');
  await page.waitForFunction(() => !LEAgent._internal.A.queue.length && !LEAgent._internal.A.running);
  await p;

  const fin = await A(() => LEAgent.state({ image: 256 }));
  check(/^data:image\/png/.test(fin.image), 'state image');
  await A(() => LEAgent.end({ summary: 'Launch post ready: headline, photo, badge and icon. Contrast fixed; your note done.' }));
  await page.waitForTimeout(500);
  await shot(page, 'feed-and-summary', 'The session ends with a summary; the feed lists every change with its own Undo.');
  await page.click('.sxa-entry .sxa-entry-acts [data-ops]');
  await page.waitForTimeout(200);
  await shot(page, 'feed-details', 'Each entry expands to the exact operations.');
  const errs = page.errors.slice();
  await page.context().close();
  return errs;
}

async function consoleChannel(browser, base) {
  log('— channel 2: console (click, type, read) —');
  const page = await h.open(browser, base, '/studio/?agent=console', 'phone');
  await page.waitForFunction(() => window.LEAgent && LEAgent._internal.A.ready);
  await page.waitForSelector('.sxa-ask');
  await page.getByRole('button', { name: 'Turn on agent mode' }).click();
  /* From here on the "agent" uses only the accessibility-visible controls. */
  const box = page.getByLabel('Agent command');
  await box.waitFor();
  async function run(cmd) {
    await box.fill(typeof cmd === 'string' ? cmd : JSON.stringify(cmd));
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => { const r = document.getElementById('sxa-result'); return r && r.textContent !== 'Running…'; }, null, { timeout: 60000 });
    return JSON.parse(await page.getByLabel('Agent result').textContent());
  }
  const b = await run({ op: 'begin', name: 'Codex', task: 'A square sale card' });
  check(b.ok, 'console begin');
  const a = await run({ op: 'apply', label: 'Sale card', ops: [
    { op: 'page.background', background: '#FFF3E2' },
    { op: 'add', layer: { id: 'title', type: 'text', text: 'SUMMER SALE', font: 'Anton', size: 200, color: '#17131F', x: 'center', y: 180, w: '86%', h: 380, fit: 'shrink', align: 'center' } },
    { op: 'add', layer: { id: 'pill', type: 'shape', shape: 'rounded-rectangle', params: { radius: 60 }, fill: '#E0668E', x: 'center', y: 660, w: 520, h: 120 } },
    { op: 'add', layer: { id: 'pill-text', type: 'text', text: 'Up to 50% off', size: 54, color: '#FFFFFF', x: 'center', y: 690, w: 520, align: 'center' } }
  ] });
  check(a.ok, 'console apply ' + JSON.stringify(a.errors));
  const c = await run({ op: 'check' });
  log('console check:', c.count, 'problem(s)');
  await page.waitForTimeout(400);
  await shot(page, 'console-phone', 'Phone, console channel: the agent types JSON into "Agent command", presses Run and reads the result.');
  const end = await run({ op: 'end', summary: 'Sale card done' });
  check(end.ok, 'console end');
  const errs = page.errors.slice();
  await page.context().close();
  return errs;
}

async function linkChannel(browser, base) {
  log('— channel 3: link (#ops=) —');
  const payload = { name: 'Gemini', task: 'Turn the blank page into a quote card', ops: [
    { op: 'page.background', background: '#141318' },
    { op: 'add', layer: { id: 'quote', type: 'text', text: '“Ship small, ship often.”', font: 'Playfair Display', size: 110, color: '#F2EFE9', x: 'center', y: 'center', w: '80%', h: 420, fit: 'shrink', align: 'center' } },
    { op: 'add', layer: { id: 'by', type: 'text', text: '— The LocalEditor team', size: 40, weight: 600, color: '#E0B354', x: 'center', y: 800, w: '80%', align: 'center' } }
  ] };
  const url = '/studio/?agent=1#ops=j' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  const page = await h.open(browser, base, url, 'desktop');
  await page.waitForFunction(() => window.LEAgent && LEAgent._internal.A.ready);
  await page.waitForSelector('.sxa-ask');
  await page.click('.sxa-ask [data-no]');
  await page.waitForFunction(() => /Apply these changes|sent/.test((document.querySelector('.sxa-ask') || {}).textContent || ''));
  await shot(page, 'link-confirm', 'Link channel: nothing changes until the person reads the list and presses Apply changes.');
  await page.click('.sxa-ask [data-yes]');
  await page.waitForFunction(() => LEStudio.S.project && LEStudio.scene.toJSON().layers.length === 2, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot(page, 'link-applied', 'Applied as one undoable batch, shown in the feed as coming from the link.');
  const errs = page.errors.slice();
  await page.context().close();
  return errs;
}

(async () => {
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  let errors = [];
  try {
    errors = errors.concat(await evaluateChannel(browser, base));
    errors = errors.concat(await consoleChannel(browser, base));
    errors = errors.concat(await linkChannel(browser, base));
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(shots, null, 2));
  log(shots.length + ' screenshots in ' + OUT);
  if (errors.length) { console.error('Console errors:\n' + errors.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
