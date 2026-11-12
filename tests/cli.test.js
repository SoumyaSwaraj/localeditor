'use strict';
/* The fast path for agents: tools/le-cli (the `localeditor` command). Every case spawns the real command, pointed at
   Playwright's Chromium through LE_BROWSER, in a throwaway folder with its own TMPDIR (so engine profiles can be
   counted). Asserts on files, exit codes, JSON output and rendered pixels. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'tools', 'le-cli', 'bin', 'localeditor.js');
const BROWSER = () => require('playwright').chromium.executablePath();
const cases = {};

function workdir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'le-cli-' + tag + '-'));
  fs.mkdirSync(path.join(d, 'tmp'));
  return d;
}
function env(dir, extra) { return Object.assign({}, process.env, { LE_BROWSER: BROWSER(), TMPDIR: path.join(dir, 'tmp'), LE_NO_OPEN: '1' }, extra || {}); }
/* run(['apply', …], { cwd, input }) → { code, stdout, stderr, json } */
function run(args, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const c = spawn(o.node || process.execPath, [BIN].concat(args), { cwd: o.cwd, env: env(o.cwd, o.env), stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    c.stdout.on('data', (d) => out.push(d));
    c.stderr.on('data', (d) => err.push(d));
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('localeditor ' + args.join(' ') + ' timed out')); }, o.timeout || 80000);
    c.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      let json = null;
      try { json = JSON.parse(stdout.toString('utf8')); } catch (e) { /* not JSON */ }
      resolve({ code, stdout: o.binary ? stdout : stdout.toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), json, ms: Date.now() - t0 });
    });
    c.stdin.end(o.input || '');
  });
}
const engineProfiles = (dir) => fs.readdirSync(path.join(dir, 'tmp')).filter((f) => f.startsWith('localeditor-engine-'));
function chromeProcs(dir) {
  try { return execFileSync('pgrep', ['-f', path.join(dir, 'tmp', 'localeditor-engine-')]).toString().trim().split('\n').filter(Boolean); } catch (e) { return []; }
}

/* Pixel colour at (x, y) of a PNG, decoded by the test browser. */
async function pixel(browser, png, x, y) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate(async ([b64, X, Y]) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
      return Array.from(x.getImageData(X, Y, 1, 1).data);
    }, [png.toString('base64'), x, y]);
  } finally { await ctx.close(); }
}
const near = (a, b, tol) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= (tol || 6));

cases['doctor passes with the pre-installed Chromium (pipe and port transports)'] = async ({ h }) => {
  const dir = workdir('doctor');
  const r = await run(['doctor', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'doctor exit code (' + r.stderr + r.stdout.slice(0, 400) + ')');
  h.assert(r.json && r.json.ok, 'doctor ok');
  const names = r.json.checks.map((c) => c.name).join(' | ');
  h.assert(/Renders hello-world/.test(names) && /Network sealed/.test(names), 'doctor checks rendering and the network seal: ' + names);
  h.assert(r.json.checks.every((c) => c.ok), 'every doctor check passes: ' + JSON.stringify(r.json.checks.filter((c) => !c.ok)));
  h.assert(/pipe transport/.test(names), 'default transport is the debugging pipe');
  const p = await run(['doctor', '--json', '--transport', 'port'], { cwd: dir });
  h.assert.equal(p.code, 0, 'doctor over the port transport: ' + p.stdout.slice(0, 300));
  h.assert(/port transport/.test(p.json.checks.map((c) => c.name).join(' ')), 'port transport used');
  h.assert.equal(engineProfiles(dir).length, 0, 'temp profiles removed');
  h.assert.equal(chromeProcs(dir).length, 0, 'no browser left running');
  console.log('       doctor (cold start incl. browser launch and a render): ' + r.ms + ' ms');
};

cases['new → apply (text with fit shrink, shape, photo slot) → update → remove → check → render reflects each change'] = async ({ browser, h }) => {
  const dir = workdir('flow');
  const f = 'post.ledesign.json';
  let r = await run(['new', f, '--size', '1080x1350', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'new: ' + r.stderr);
  h.assert(fs.existsSync(path.join(dir, f)), 'file created');
  const ops = [
    { op: 'page.background', background: '#FFFFFF' },
    { op: 'add', layer: { id: 'title', type: 'text', text: 'A long headline that has to shrink to fit', font: 'Inter', size: 400, color: '#17131F', x: 'center', y: 60, w: '80%', h: 260, fit: 'shrink' } },
    { op: 'add', layer: { id: 'block', type: 'shape', shape: 'rectangle', fill: '#FF0000', x: 100, y: 500, w: 300, h: 300 } },
    { op: 'add', layer: { id: 'hero', type: 'image', slot: true, x: 600, y: 500, w: 400, h: 400 } }
  ];
  r = await run(['apply', f, '-', '--json'], { cwd: dir, input: JSON.stringify(ops) });
  h.assert.equal(r.code, 0, 'apply: ' + r.stdout.slice(0, 500) + r.stderr);
  h.assert(r.json.written && r.json.applied === 4, 'four operations applied and written');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const L = (id) => doc.pages[0].layers.find((l) => l.id === id);
  h.assert(L('title').size < 400 && L('title').size > 20, 'fit:"shrink" chose a smaller size: ' + L('title').size);
  h.assert.equal(L('title').x, 108, '"x":"center" with "w":"80%" is normalised to pixels');
  h.assert(!('fit' in L('title')), 'the long form has no fit shorthand');
  h.assert(L('hero').slot, 'photo slot kept');
  r = await run(['render', f, '-o', 'a.png', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'render: ' + r.stderr);
  const a = fs.readFileSync(path.join(dir, 'a.png'));
  const info = h.imageInfo(a);
  h.assert(info.type === 'png' && info.w === 1080 && info.h === 1350, 'PNG at the page size: ' + JSON.stringify(info));
  h.assert(near(await pixel(browser, a, 250, 650), [255, 0, 0]), 'the red block is drawn');
  r = await run(['apply', f, JSON.stringify([{ op: 'update', id: 'block', set: { fill: '#0000FF' } }]), '--render', 'b.png', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'update: ' + r.stderr + r.stdout.slice(0, 300));
  h.assert(near(await pixel(browser, fs.readFileSync(path.join(dir, 'b.png')), 250, 650), [0, 0, 255]), 'the update shows in the render');
  r = await run(['apply', f, JSON.stringify([{ op: 'remove', id: 'block' }]), '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'remove');
  r = await run(['render', f, '-o', 'c.png', '--scale', '0.5', '--json'], { cwd: dir });
  const c = fs.readFileSync(path.join(dir, 'c.png'));
  h.assert.equal(h.imageInfo(c).w, 540, '--scale 0.5 halves the size');
  h.assert(near(await pixel(browser, c, 125, 325), [255, 255, 255]), 'the removed block is gone');
  h.assert.equal(engineProfiles(dir).length, 0, 'temp profiles removed after every command');
};

cases['check, show and find; apply reports new problems; bad batches are atomic and name the operation'] = async ({ h }) => {
  const dir = workdir('check');
  const f = 'post.ledesign.json';
  fs.writeFileSync(path.join(dir, f), JSON.stringify({ format: 'localeditor-design', version: 1, name: 'C', pages: [{ width: 1080, height: 1350, background: '#ffffff', layers: [
    { id: 'title', type: 'text', text: 'A long headline that has to shrink to fit', font: 'Inter', size: 400, color: '#17131F', x: 'center', y: 60, w: '80%', h: 260, fit: 'shrink' },
    { id: 'hero', type: 'image', slot: true, x: 600, y: 500, w: 400, h: 400 }] }] }));
  let r = await run(['check', f, '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'check passes on a clean design: ' + JSON.stringify(r.json && r.json.problems));
  r = await run(['apply', f, JSON.stringify([{ op: 'add', layer: { id: 'pale', type: 'text', text: 'Pale words that nobody can read at all', color: '#F4F4F4', size: 40, x: 100, y: 1000, w: 800 } }, { op: 'add', layer: { id: 'lost', type: 'shape', shape: 'ellipse', fill: '#000', x: 3000, y: 3000, w: 50, h: 50 } }]), '--json'], { cwd: dir });
  h.assert(r.json.newProblems.some((p) => p.kind === 'low-contrast' && p.layer === 'pale'), 'apply reports the new low-contrast problem');
  r = await run(['check', f, '--json'], { cwd: dir });
  h.assert.equal(r.code, 1, 'check exits 1 with problems');
  const kinds = r.json.problems.map((p) => p.kind + ':' + p.layer);
  h.assert(kinds.includes('low-contrast:pale') && kinds.includes('off-page:lost'), 'problems: ' + kinds.join(', '));
  h.assert(r.json.problems.every((p) => /^\/pages\/0\/layers\/\d+/.test(p.path)), 'problems carry JSON pointers');
  r = await run(['check', f, '--max-warnings', '5', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, '--max-warnings allows them');
  r = await run(['show', f, '--json'], { cwd: dir });
  h.assert(r.json.outline.pages[0].layers.map((l) => l.id).join(',') === 'title,hero,pale,lost', 'show lists layer ids in order');
  r = await run(['find', f, 'headline', '--json'], { cwd: dir });
  h.assert(r.json.matches.length === 1 && r.json.matches[0].id === 'title', 'find by text');
  r = await run(['apply', f, JSON.stringify([{ op: 'update', id: 'nope', set: { x: 1 } }, { op: 'remove', id: 'title' }]), '--json'], { cwd: dir });
  h.assert.equal(r.code, 1, 'a bad batch fails');
  h.assert(r.json.code === 'not-found' && r.json.errors[0].path === '/ops/0/id', 'error names the operation: ' + JSON.stringify(r.json.errors));
  h.assert(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).pages[0].layers.some((l) => l.id === 'title'), 'atomic: nothing applied');
  r = await run(['apply', f, JSON.stringify([{ op: 'update', id: 'title', set: { opacity: 'half' } }]), '--json'], { cwd: dir });
  h.assert(r.code === 1 && r.json.errors.some((e) => /opacity/.test(e.path)), 'validation errors after an operation carry the field path: ' + JSON.stringify(r.json.errors));
};

cases['the file is normalised and byte-stable across two no-op applies; --dry-run writes nothing'] = async ({ h }) => {
  const dir = workdir('stable');
  fs.writeFileSync(path.join(dir, 'd.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, name: 'S', pages: [{ width: 800, height: 600, background: '#123456', layers: [
    { id: 't', type: 'text', text: 'Hi', x: 'center', y: 'center', w: '50%' }, { id: 's', type: 'shape', shape: 'star', fill: '#E0B354', x: 10, y: 10, w: 100, h: 100 }, { id: 'i', type: 'icon', icon: 'lucide:sun', x: 700, y: 10, w: 64 }
  ] }] }));
  let r = await run(['apply', 'd.ledesign.json', '[]', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'first apply normalises: ' + r.stderr);
  const one = fs.readFileSync(path.join(dir, 'd.ledesign.json'), 'utf8');
  h.assert(/\n {2}"pages": \[\n/.test(one) && /"x": 200/.test(one), 'long form, two-space indent, positions in pixels');
  r = await run(['apply', 'd.ledesign.json', '[]', '--json'], { cwd: dir });
  const two = fs.readFileSync(path.join(dir, 'd.ledesign.json'), 'utf8');
  h.assert.equal(r.json.written, false, 'second no-op apply does not write');
  r = await run(['apply', 'd.ledesign.json', '[]', '--json'], { cwd: dir });
  h.assert.equal(fs.readFileSync(path.join(dir, 'd.ledesign.json'), 'utf8'), one, 'byte-stable');
  h.assert.equal(two, one, 'byte-stable (2)');
  r = await run(['apply', 'd.ledesign.json', JSON.stringify([{ op: 'remove', id: 's' }]), '--dry-run', '--json'], { cwd: dir });
  h.assert(r.code === 0 && r.json.dryRun && !r.json.written, 'dry run');
  h.assert.equal(fs.readFileSync(path.join(dir, 'd.ledesign.json'), 'utf8'), one, 'dry run leaves the file alone');
  r = await run(['apply', 'd.ledesign.json', JSON.stringify([{ op: 'remove', id: 's' }]), '--if-rev', 'deadbeefdeadbeef', '--json'], { cwd: dir });
  h.assert(r.code === 1 && r.json && r.json.code === 'conflict', '--if-rev with a stale revision is a conflict: ' + r.stdout.slice(0, 300) + r.stderr.slice(0, 300));
};

cases['validate refuses hostile files with JSON-pointer paths'] = async ({ h }) => {
  const dir = workdir('hostile');
  const base = (layers, extra) => JSON.stringify(Object.assign({ format: 'localeditor-design', version: 1, name: 'H', pages: [{ width: 500, height: 500, layers }] }, extra || {}));
  fs.writeFileSync(path.join(dir, 'script.ledesign.json'), base([{ id: 't', type: 'text', text: '<script>alert(1)</script>' }]));
  fs.writeFileSync(path.join(dir, 'proto.ledesign.json'), '{"format":"localeditor-design","version":1,"pages":[{"layers":[{"id":"a","type":"shape","w":10,"h":10,"__proto__":{"x":1}}]}]}');
  fs.writeFileSync(path.join(dir, 'jsurl.ledesign.json'), base([{ id: 'p', type: 'image', src: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 }]));
  fs.writeFileSync(path.join(dir, 'svg.ledesign.json'), base([{ id: 'v', type: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="5" height="5"/></svg>', x: 0, y: 0, w: 10, h: 10 }]));
  fs.writeFileSync(path.join(dir, 'big.ledesign.json'), base([{ id: 't', type: 'text', text: 'x' }], { name: 'x'.repeat(13 * 1024 * 1024) }));
  fs.writeFileSync(path.join(dir, 'ok.ledesign.json'), base([{ id: 't', type: 'text', text: 'Fine' }]));
  const r = await run(['validate', 'script.ledesign.json', 'proto.ledesign.json', 'jsurl.ledesign.json', 'svg.ledesign.json', 'big.ledesign.json', 'ok.ledesign.json', '--json'], { cwd: dir });
  h.assert.equal(r.code, 1, 'validate exits 1');
  const by = {};
  r.json.files.forEach((f) => { by[f.file] = f; });
  h.assert(!by['script.ledesign.json'].ok && by['script.ledesign.json'].errors[0].path === '/pages/0/layers/0/text', 'script string refused at its path: ' + JSON.stringify(by['script.ledesign.json'].errors));
  h.assert(!by['proto.ledesign.json'].ok && /__proto__/.test(by['proto.ledesign.json'].errors[0].path), 'forbidden key refused: ' + JSON.stringify(by['proto.ledesign.json'].errors));
  h.assert(!by['jsurl.ledesign.json'].ok && /\/src$/.test(by['jsurl.ledesign.json'].errors[0].path), 'javascript: URL refused: ' + JSON.stringify(by['jsurl.ledesign.json'].errors));
  h.assert(!by['svg.ledesign.json'].ok && /svg/.test(by['svg.ledesign.json'].errors[0].path), 'SVG with a handler refused');
  h.assert(!by['big.ledesign.json'].ok && /12 MB/.test(by['big.ledesign.json'].errors[0].message), 'oversize refused: ' + JSON.stringify(by['big.ledesign.json'].errors));
  h.assert(by['ok.ledesign.json'].ok, 'a clean file passes');
  const human = await run(['validate', 'script.ledesign.json'], { cwd: dir });
  h.assert(/\/pages\/0\/layers\/0\/text: /.test(human.stdout), 'human output shows the pointer');
  const ops = await run(['apply', 'ok.ledesign.json', JSON.stringify([{ op: 'update', id: 't', set: { text: '<img src=x onerror=alert(1)>' } }]), '--json'], { cwd: dir });
  h.assert(ops.code === 1 && ops.json.errors.some((e) => /text/.test(e.path)), 'operations cannot smuggle HTML in');
};

cases['convert round trips .ledesign.json ↔ .leproject and embedded ↔ assets-folder images'] = async ({ browser, h }) => {
  const dir = workdir('convert');
  const png = await (async () => {
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    const u = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 8; c.height = 4; const x = c.getContext('2d'); x.fillStyle = '#2f9e5b'; x.fillRect(0, 0, 8, 4); return c.toDataURL('image/png'); });
    await ctx.close(); return u;
  })();
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'green.png'), Buffer.from(png.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(dir, 'd.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, name: 'Conv', pages: [{ id: 'one', width: 400, height: 200, layers: [
    { id: 'pic', type: 'image', src: 'assets/green.png', x: 0, y: 0, w: 400, h: 200 }, { id: 't', type: 'text', text: 'Round trip', x: 20, y: 20, w: 300 }] }] }));
  let r = await run(['convert', 'd.ledesign.json', 'd.leproject', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'to .leproject: ' + r.stderr + r.stdout.slice(0, 300));
  h.assert.equal(fs.readFileSync(path.join(dir, 'd.leproject')).slice(0, 2).toString(), 'PK', 'a zip');
  r = await run(['convert', 'd.leproject', 'back.ledesign.json', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'back to .ledesign.json: ' + r.stderr + r.stdout.slice(0, 300));
  const back = JSON.parse(fs.readFileSync(path.join(dir, 'back.ledesign.json'), 'utf8'));
  h.assert(/^data:image\/png;base64,/.test(back.pages[0].layers[0].src), 'images embedded by default');
  h.assert.equal(back.pages[0].layers[1].text, 'Round trip', 'text survives');
  h.assert.equal(back.pages[0].id, 'one', 'page id survives');
  r = await run(['convert', 'back.ledesign.json', 'out/split.ledesign.json', '--images', 'assets', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'embed → assets folder');
  const split = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'split.ledesign.json'), 'utf8'));
  const rel = split.pages[0].layers[0].src;
  h.assert(/^assets\/[\w.-]+\.png$/.test(rel) && fs.existsSync(path.join(dir, 'out', rel)), 'image written next to the design: ' + rel);
  r = await run(['convert', 'out/split.ledesign.json', 'again.ledesign.json', '--json'], { cwd: dir });
  const again = JSON.parse(fs.readFileSync(path.join(dir, 'again.ledesign.json'), 'utf8'));
  h.assert.equal(again.pages[0].layers[0].src, back.pages[0].layers[0].src, 'assets folder → embedded gives the same bytes');
  r = await run(['render', 'again.ledesign.json', '-o', 'g.png', '--json'], { cwd: dir });
  h.assert(near(await pixel(browser, fs.readFileSync(path.join(dir, 'g.png')), 300, 150), [47, 158, 91], 8), 'the photo renders after the round trip');
};

cases['remote images are reported and never fetched; the URL stays in the file'] = async ({ h }) => {
  const dir = workdir('remote');
  let hits = 0;
  const srv = require('net').createServer((sock) => { hits++; sock.destroy(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    fs.writeFileSync(path.join(dir, 'r.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, name: 'R', pages: [{ width: 400, height: 400, layers: [
      { id: 'web', type: 'image', src: 'https://images.example.com/beach.jpg', x: 0, y: 0, w: 400, h: 300 },
      { id: 'local', type: 'image', src: 'https://127.0.0.1:' + srv.address().port + '/x.png', x: 0, y: 300, w: 100, h: 100 }] }] }));
    let r = await run(['check', 'r.ledesign.json', '--json'], { cwd: dir });
    h.assert.equal(r.code, 1, 'check flags remote images');
    const remote = r.json.problems.filter((p) => p.kind === 'remote-image');
    h.assert(remote.length === 2 && remote.some((p) => p.layer === 'web' && /images\.example\.com/.test(p.message)), 'both reported with layer and host: ' + JSON.stringify(remote));
    h.assert(r.json.remote.some((x) => x.host === 'images.example.com'), 'hosts listed');
    r = await run(['render', 'r.ledesign.json', '-o', 'r.png', '--json', '--verbose'], { cwd: dir });
    h.assert.equal(r.code, 0, 'renders with empty frames');
    r = await run(['apply', 'r.ledesign.json', '[]', '--json'], { cwd: dir });
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'r.ledesign.json'), 'utf8'));
    h.assert.equal(doc.pages[0].layers[0].src, 'https://images.example.com/beach.jpg', 'the URL is kept when the file is written back');
    h.assert.equal(hits, 0, 'no connection reached the local "remote" server');
  } finally { srv.close(); }
};

cases['path traversal and symlink escapes are refused; --allow-path permits a folder'] = async ({ browser, h }) => {
  const dir = workdir('sandbox');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'le-outside-'));
  const ctx = await browser.newContext(); const pg = await ctx.newPage();
  const png = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 4, 4); return c.toDataURL('image/png'); });
  await ctx.close();
  fs.writeFileSync(path.join(outside, 'secret.png'), Buffer.from(png.split(',')[1], 'base64'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.symlinkSync(path.join(outside, 'secret.png'), path.join(dir, 'assets', 'link.png'));
  fs.writeFileSync(path.join(dir, 'up.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 100, height: 100, layers: [{ id: 'p', type: 'image', src: '../secret.png', x: 0, y: 0, w: 100, h: 100 }] }] }));
  fs.writeFileSync(path.join(dir, 'sym.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, pages: [{ width: 100, height: 100, background: '#ffffff', layers: [{ id: 'p', type: 'image', src: 'assets/link.png', x: 0, y: 0, w: 100, h: 100 }] }] }));
  let r = await run(['validate', 'up.ledesign.json', '--json'], { cwd: dir });
  h.assert(r.code === 1 && /\/src$/.test(r.json.files[0].errors[0].path), '".." in an image path is refused: ' + JSON.stringify(r.json.files[0].errors));
  r = await run(['check', 'sym.ledesign.json', '--json'], { cwd: dir });
  h.assert(r.json.problems.some((p) => p.kind === 'refused-path'), 'a symlink out of the folder is refused: ' + JSON.stringify(r.json.problems));
  r = await run(['render', 'sym.ledesign.json', '-o', 's.png'], { cwd: dir });
  const px = await pixel(browser, fs.readFileSync(path.join(dir, 's.png')), 50, 50);
  h.assert(!near(px, [255, 0, 255], 20), 'the outside image was not read');
  r = await run(['render', 'sym.ledesign.json', '-o', 's2.png', '--allow-path', outside], { cwd: dir });
  h.assert(near(await pixel(browser, fs.readFileSync(path.join(dir, 's2.png')), 50, 50), [255, 0, 255], 20), '--allow-path lets it through');
};

cases['make builds a design from a quick maker; catalog lists fonts, icons, shapes, sizes and makers'] = async ({ h }) => {
  const dir = workdir('make');
  let r = await run(['catalog', 'makers', '--json'], { cwd: dir });
  h.assert(r.code === 0 && r.json.items.length >= 6, 'makers listed');
  const m = r.json.items.find((x) => x.inputs.some((i) => i.type === 'text' && i.required)) || r.json.items[0];
  const values = {};
  m.inputs.forEach((i) => { if (i.type === 'text' || i.type === 'longtext') values[i.key] = 'Hello there'; });
  r = await run(['make', m.id, '-o', 'made.ledesign.json', '--values', JSON.stringify(values), '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'make ' + m.id + ': ' + r.stdout.slice(0, 400) + r.stderr);
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'made.ledesign.json'), 'utf8'));
  h.assert(d.pages[0].layers.length > 1, 'the maker made layers');
  r = await run(['catalog', 'fonts', 'serif', '--json'], { cwd: dir });
  h.assert(r.json.items.some((f) => f.family === 'Playfair Display'), 'fonts');
  r = await run(['catalog', 'icons', 'sun', '--json'], { cwd: dir });
  h.assert(r.json.items.some((i) => /^lucide:sun/.test(i.id)), 'icons: ' + JSON.stringify(r.json.items.slice(0, 3)));
  r = await run(['catalog', 'sizes', 'story', '--json'], { cwd: dir });
  h.assert(r.json.items.some((s) => s.height === 1920), 'sizes');
  r = await run(['catalog', 'shapes', '--json'], { cwd: dir });
  h.assert(r.json.items.some((s) => s.id === 'star'), 'shapes');
  r = await run(['new', 'story.ledesign.json', '--preset', 'story', '--json'], { cwd: dir });
  h.assert.equal(r.code, 0, 'new with a preset');
  h.assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'story.ledesign.json'), 'utf8')).pages[0].height, 1920, 'preset size');
  r = await run(['new', 'ex.ledesign.json', '--from', 'quote-card', '--json'], { cwd: dir });
  h.assert(r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, 'ex.ledesign.json'), 'utf8')).pages[0].layers.length > 0, 'new --from an example');
  r = await run(['new', 'ex.ledesign.json', '--json'], { cwd: dir });
  h.assert(r.code === 1 && r.json.code === 'exists', 'new refuses to overwrite');
  r = await run(['bogus'], { cwd: dir });
  h.assert.equal(r.code, 2, 'unknown command is a usage error');
  r = await run(['--help'], { cwd: dir });
  h.assert(r.code === 0 && /apply <file>/.test(r.stdout), 'help');
};

cases['local API: token required, foreign Host/Origin refused, apply works, SSE delivers file changes; engine gone after SIGTERM'] = async ({ h }) => {
  const dir = workdir('api');
  fs.writeFileSync(path.join(dir, 'a.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, name: 'A', pages: [{ width: 300, height: 300, layers: [{ id: 's', type: 'shape', fill: '#ff0000', x: 0, y: 0, w: 100, h: 100 }] }] }));
  const c = spawn(process.execPath, [BIN, 'serve', '.', '--json'], { cwd: dir, env: env(dir), stdio: ['pipe', 'pipe', 'pipe'] });
  let errText = '';
  c.stderr.on('data', (d) => { errText += d; });
  try {
    const info = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('serve did not start: ' + errText)), 30000);
      c.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); resolve(JSON.parse(buf.slice(0, i))); } });
    });
    const port = new URL(info.app).port;
    const req = (p, o) => new Promise((resolve, reject) => {
      o = o || {};
      const r = http.request({ host: '127.0.0.1', port, path: p, method: o.method || 'GET', headers: Object.assign({ Host: '127.0.0.1:' + port }, o.headers || {}) }, (res) => {
        const b = []; res.on('data', (d) => b.push(d)); res.on('end', () => { const body = Buffer.concat(b); let j = null; try { j = JSON.parse(body.toString()); } catch (e) {} resolve({ status: res.statusCode, body, json: j, headers: res.headers }); });
      });
      r.on('error', reject);
      if (o.body) r.end(o.body); else r.end();
    });
    const api = '/api/' + info.token;
    const t0 = Date.now();
    h.assert.equal((await req(api + '/check?file=a.ledesign.json')).status, 200, 'first call starts the engine');
    const coldMs = Date.now() - t0;
    h.assert.equal((await req('/api/wrong-token-wrong-token/state?file=a.ledesign.json')).status, 401, 'wrong token refused');
    h.assert.equal((await req(api + '/state?file=a.ledesign.json', { headers: { Host: 'evil.example:' + port } })).status, 403, 'foreign Host refused (DNS rebinding)');
    h.assert.equal((await req(api + '/state?file=a.ledesign.json', { headers: { Origin: 'https://evil.example' } })).status, 403, 'foreign Origin refused');
    h.assert.equal((await req(api + '/state?file=a.ledesign.json', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'cross-site fetch refused');
    h.assert.equal((await req('/studio/', { headers: { Host: 'localhost:' + port } })).status, 200, 'the app is served for people');
    const st = await req(api + '/state?file=a.ledesign.json');
    h.assert(st.status === 200 && st.json.outline.pages[0].layers[0].id === 's', 'state');
    h.assert.equal((await req(api + '/state?file=../../etc/passwd')).status, 403, 'path traversal through the API refused');
    h.assert.equal((await req(api + '/apply', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 422, 'non-JSON body refused');
    const events = [];
    const sseReq = http.request({ host: '127.0.0.1', port, path: api + '/events?file=a.ledesign.json', headers: { Host: '127.0.0.1:' + port } }, (res) => {
      res.on('data', (d) => { String(d).split('\n\n').forEach((blk) => { const m = /event: (\w+)\ndata: (.*)/.exec(blk); if (m) events.push([m[1], JSON.parse(m[2])]); }); });
    });
    sseReq.end();
    await new Promise((r) => setTimeout(r, 400));
    let ap = await req(api + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'a.ledesign.json', ops: [{ op: 'update', id: 's', set: { x: 50 } }] }) });
    h.assert(ap.status === 200 && ap.json.written, 'apply over HTTP: ' + ap.body.toString().slice(0, 300));
    const t2 = Date.now();
    ap = await req(api + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'a.ledesign.json', ops: [{ op: 'update', id: 's', set: { x: 60 } }] }) });
    const warm = Date.now() - t2;
    const t3 = Date.now();
    const png = await req(api + '/render?file=a.ledesign.json');
    const renderMs = Date.now() - t3;
    h.assert(png.status === 200 && png.headers['content-type'] === 'image/png' && h.imageInfo(png.body).w === 300, 'render over HTTP');
    for (let i = 0; i < 40 && !events.some((e) => e[0] === 'change'); i++) await new Promise((r) => setTimeout(r, 100));
    h.assert(events.some((e) => e[0] === 'change' && e[1].rev), 'SSE delivered the change: ' + JSON.stringify(events));
    fs.writeFileSync(path.join(dir, 'a.ledesign.json'), '{ broken');
    for (let i = 0; i < 40 && !events.some((e) => e[0] === 'invalid'); i++) await new Promise((r) => setTimeout(r, 100));
    h.assert(events.some((e) => e[0] === 'invalid'), 'SSE reports an invalid file');
    sseReq.destroy();
    console.log('       speed: API first call ' + coldMs + ' ms (engine start + studio + load), warm apply ' + warm + ' ms; render ' + renderMs + ' ms');
    h.assert(engineProfiles(dir).length === 1 && chromeProcs(dir).length > 0, 'engine running while serving: ' + JSON.stringify([engineProfiles(dir), chromeProcs(dir), errText.slice(-300)]));
    /* The browser dies: the next call restarts it cleanly. */
    chromeProcs(dir).forEach((pid) => { try { process.kill(Number(pid), 'SIGKILL'); } catch (e) { /* already gone */ } });
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(dir, 'a.ledesign.json'), JSON.stringify({ format: 'localeditor-design', version: 1, name: 'A', pages: [{ width: 300, height: 300, layers: [{ id: 's', type: 'shape', fill: '#ff0000', x: 60, y: 0, w: 100, h: 100 }] }] }));
    const again = await req(api + '/state?file=a.ledesign.json');
    h.assert(again.status === 200 && again.json.outline.pages[0].layers[0].x === 60, 'works again after the browser was killed: ' + again.body.toString().slice(0, 200));
    h.assert.equal(engineProfiles(dir).length, 1, 'the dead profile was replaced, not left behind');
  } finally {
    c.kill('SIGTERM');
    await new Promise((r) => c.on('close', r));
  }
  for (let i = 0; i < 30 && chromeProcs(dir).length; i++) await new Promise((r) => setTimeout(r, 100));
  h.assert.equal(chromeProcs(dir).length, 0, 'browser processes gone after SIGTERM');
  h.assert.equal(engineProfiles(dir).length, 0, 'temp profile removed after SIGTERM');
};

cases['speed: cold apply, warm render through one engine (reported, not asserted)'] = async ({ h }) => {
  const dir = workdir('speed');
  await run(['new', 'p.ledesign.json'], { cwd: dir });
  const a = await run(['apply', 'p.ledesign.json', JSON.stringify([{ op: 'add', layer: { id: 't', type: 'text', text: 'Speed', size: 120, x: 'center', y: 'center' } }]), '--json'], { cwd: dir });
  const r = await run(['render', 'p.ledesign.json', '-o', 'p.png', '--json'], { cwd: dir });
  h.assert(a.code === 0 && r.code === 0, 'ran');
  console.log('       speed: cold CLI apply ' + a.ms + ' ms (in-engine ' + a.json.ms + ' ms); cold CLI render ' + r.ms + ' ms (in-engine ' + r.json.ms + ' ms)');
};

module.exports = cases;
