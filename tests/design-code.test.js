'use strict';
/* Design as code (docs/DESIGN-AS-CODE.md): the builder, `localeditor build`, `diff`, `check` on several files, and the
   GitHub Action's step run locally in a throwaway repository. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'le-cli');
const BIN = path.join(CLI, 'bin', 'localeditor.js');
const ACTION = path.join(ROOT, 'agent-kit', 'github-action');
const BROWSER = () => require('playwright').chromium.executablePath();
const cases = {};

function workdir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'le-code-' + tag + '-'));
  fs.mkdirSync(path.join(d, 'tmp'));
  return d;
}
function node(args, cwd, extra) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, args, { cwd, env: Object.assign({}, process.env, { LE_BROWSER: BROWSER(), TMPDIR: path.join(cwd, 'tmp'), LE_NO_OPEN: '1' }, extra || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { c.kill('SIGKILL'); reject(new Error(args.join(' ') + ' timed out')); }, 100000);
    c.on('close', (code) => { clearTimeout(t); let json = null; try { json = JSON.parse(out); } catch (e) { /* text */ } resolve({ code, stdout: out, stderr: err, json }); });
  });
}
const le = (args, cwd) => node([BIN].concat(args), cwd);
const pngSize = (file) => { const b = fs.readFileSync(file); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
const DOC = (layers, extra) => Object.assign({ format: 'localeditor-design', version: 1, name: 'T', pages: [{ id: 'p1', width: 600, height: 400, background: '#FFFFFF', layers }] }, extra || {});
const TITLE = (o) => Object.assign({ id: 'title', type: 'text', text: 'Hello', font: 'Inter', weight: 700, size: 48, color: '#17131F', x: 40, y: 40, w: 520, h: 80 }, o || {});

cases['the builder writes plain data: stable ids, pages, effects, and clear errors'] = async ({ h }) => {
  const { design, DesignError } = require(path.join(CLI, 'dsl.js'));
  const make = () => design({ name: 'Card', size: '800x600', brand: 'brand.lebrand.json' })
    .page({ id: 'front', background: '#14213D' })
    .text('Hi', { size: 80, color: '#FFFFFF', x: 'center', y: 40, w: '80%' })
    .image('assets/a.jpg', { id: 'hero', x: 0, y: 200, w: 800, h: 400 })
    .fx({ type: 'exposure', p: { ev: 0.3 } })
    .text('Two', {})
    .fx('hero', [{ type: 'contrast', p: { amount: 10 } }])
    .slot({ x: 10, y: 10, w: 50, h: 50 })
    .page({ size: [400, 400] })
    .shape('ellipse', { fill: '#E0B354', x: 0, y: 0, w: 100, h: 100 })
    .icon('lucide:cake', { x: 0, y: 0, w: 40 })
    .adjust({ type: 'contrast', p: { amount: 5 } });
  const doc = make().toJSON();
  h.assert.equal(JSON.stringify(doc), JSON.stringify(make().toJSON()), 'the same script gives the same file');
  h.assert(doc.format === 'localeditor-design' && doc.version === 1 && doc.brand === 'brand.lebrand.json' && doc.pages.length === 2, 'document');
  h.assert.equal(doc.pages[0].layers.map((l) => l.id).join(','), 'text-1,hero,text-2,image-1');
  h.assert(doc.pages[0].width === 800 && doc.pages[1].width === 400 && doc.pages[0].layers[3].slot === true, 'sizes and slots');
  h.assert.equal(doc.pages[0].layers[1].fx.map((f) => f.type).join(','), 'exposure,contrast');
  h.assert.equal(doc.pages[1].layers.map((l) => l.type).join(','), 'shape,icon,adjust');
  h.assert(JSON.parse(make().toString()).pages.length === 2, 'toString is JSON');
  const fails = (fn) => { try { fn(); return ''; } catch (e) { return e instanceof DesignError ? e.message : 'other: ' + e.message; } };
  h.assert(/used twice/.test(fails(() => design().text('a', { id: 'x' }).text('b', { id: 'x' }))), 'duplicate ids are refused');
  h.assert(/plain data/.test(fails(() => design().text('a', { onClick: () => 1 }))), 'functions are refused');
  h.assert(/plain data/.test(fails(() => design().shape('rect', { when: new Date() }))), 'class instances are refused');
  h.assert(/not allowed/.test(fails(() => design().layer(JSON.parse('{"type":"text","__proto__":{"a":1}}')))), 'forbidden keys are refused');
  h.assert(/no layer/.test(fails(() => design().text('a').fx('nope', { type: 'exposure' }))), 'fx names a real layer');
  h.assert(/width, height/.test(fails(() => design({ size: 'big' }))), 'sizes are checked');
};

cases['build: a script becomes .ledesign.json files and a picture per page; JSON sources and bad scripts'] = async ({ h }) => {
  const dir = workdir('build');
  fs.writeFileSync(path.join(dir, 'cards.design.js'), `
    const { design } = require('localeditor/dsl');
    const card = (name, bg) => design({ name, size: [600, 400] }).page({ background: bg }).text(name, { id: 'title', font: 'Inter', size: 60, color: '#FFFFFF', x: 'center', y: 150, w: '80%', align: 'center' });
    module.exports = async () => ({ ana: card('Ana', '#14213D'), ben: card('Ben', '#17131F').page({ background: '#14213D' }).shape('ellipse', { fill: '#E0B354', x: 250, y: 150, w: 100, h: 100 }) });
  `);
  const r = await le(['build', 'cards.design.js', '-o', 'out', '--json'], dir);
  h.assert(r.code === 0 && r.json && r.json.designs.length === 2, r.stdout.slice(0, 400) + r.stderr);
  const ana = JSON.parse(fs.readFileSync(path.join(dir, 'ana.ledesign.json'), 'utf8'));
  h.assert(ana.format === 'localeditor-design' && ana.pages[0].layers[0].text === 'Ana', 'the design is written next to the script');
  h.assert(!/function|=>|require\(/.test(fs.readFileSync(path.join(dir, 'ben.ledesign.json'), 'utf8')), 'the output is data, not code');
  h.assert.equal(String(pngSize(path.join(dir, 'out', 'ana.png'))), '600,400');
  h.assert(pngSize(path.join(dir, 'out', 'ben-0.png')) && pngSize(path.join(dir, 'out', 'ben-1.png')), 'one picture per page');
  const again = await le(['build', 'ana.ledesign.json', 'ben.ledesign.json', '-o', 'pics', '--format', 'jpg,pdf', '--json'], dir);
  h.assert(again.code === 0 && fs.existsSync(path.join(dir, 'pics', 'ana.jpg')) && fs.readFileSync(path.join(dir, 'pics', 'ben.pdf')).slice(0, 4).toString() === '%PDF', 'JSON sources, jpg and pdf: ' + again.stdout.slice(0, 300) + again.stderr);
  fs.writeFileSync(path.join(dir, 'bad.design.js'), 'module.exports = { nope: 42 };');
  const bad = await le(['build', 'bad.design.js', '--json'], dir);
  h.assert(bad.code === 1 && bad.json.ok === false && /not a design/.test(bad.json.message), 'a script that exports no design: ' + bad.stdout.slice(0, 200));
  fs.writeFileSync(path.join(dir, 'throws.design.js'), 'throw new Error("boom");');
  const thr = await le(['build', 'throws.design.js', '--json'], dir);
  h.assert(thr.code === 1 && /boom/.test(thr.json.message), 'a script that throws is reported: ' + thr.stdout.slice(0, 200));
};

cases['diff: changes by layer id, a pixel picture, exit codes; check takes several files'] = async ({ h }) => {
  const dir = workdir('diff');
  const w = (name, doc) => fs.writeFileSync(path.join(dir, name), JSON.stringify(doc));
  w('a.ledesign.json', DOC([TITLE(), { id: 'bar', type: 'shape', shape: 'rect', fill: '#14213D', x: 40, y: 300, w: 200, h: 20 }]));
  w('same.ledesign.json', DOC([TITLE(), { id: 'bar', type: 'shape', shape: 'rect', fill: { type: 'solid', color: '#14213D' }, x: 40, y: 300, w: 200, h: 20 }]));
  w('b.ledesign.json', DOC([TITLE({ color: '#C0392B', x: 60 }), { id: 'dot', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 400, y: 250, w: 80, h: 80 }]));
  const same = await le(['diff', 'a.ledesign.json', 'same.ledesign.json', '--json'], dir);
  h.assert(same.code === 0 && same.json.same === true && !same.json.changes.length, 'shorthand and long form are the same design: ' + same.stdout.slice(0, 300));
  const d = await le(['diff', 'a.ledesign.json', 'b.ledesign.json', '--pixels', 'out/diff.png', '--json'], dir);
  h.assert.equal(d.code, 1);
  const kinds = d.json.changes.map((c) => c.kind + ':' + c.id);
  ['layer-changed:title', 'layer-removed:bar', 'layer-added:dot'].forEach((k) => h.assert(kinds.includes(k), k + ' in ' + kinds.join(', ')));
  const ch = d.json.changes.find((c) => c.id === 'title');
  h.assert(ch.fields.includes('color') && ch.fields.includes('x') && ch.before.x === 40 && ch.after.x === 60 && /C0392B/i.test(ch.after.color), JSON.stringify(ch));
  h.assert(d.json.summary.layersChanged === 1 && d.json.summary.layersAdded === 1 && d.json.summary.layersRemoved === 1 && Array.isArray(d.json.ops), 'summary and operations');
  h.assert(d.json.pixels[0].changed > 500 && d.json.pixels[0].share < 0.5 && String(pngSize(path.join(dir, 'out', 'diff.png'))) === '600,400', 'pixel picture: ' + JSON.stringify(d.json.pixels[0]));
  const text = await le(['diff', 'a.ledesign.json', 'b.ledesign.json'], dir);
  h.assert(/~ layer title: .*color/.test(text.stdout) && /\+ layer dot/.test(text.stdout) && /- layer bar/.test(text.stdout), text.stdout);

  w('over.ledesign.json', DOC([TITLE({ text: 'This headline is far too long for the small box it was given', h: 40 })]));
  const ok = await le(['check', 'a.ledesign.json', 'b.ledesign.json', '--json'], dir);
  h.assert(ok.code === 0 && ok.json.files.length === 2 && ok.json.ok, 'two clean files: ' + ok.stdout.slice(0, 200));
  const no = await le(['check', 'a.ledesign.json', 'over.ledesign.json', '--json'], dir);
  h.assert(no.code === 1 && no.json.files[0].ok && !no.json.files[1].ok && no.json.files[1].problems.some((p) => p.kind === 'overflow'), 'one bad file fails the run');
};

cases['GitHub Action: only allowed actions, inputs through the environment; its step builds changed designs, checks them and writes a summary'] = async ({ h }) => {
  const yml = fs.readFileSync(path.join(ACTION, 'action.yml'), 'utf8');
  const uses = (yml.match(/uses:\s*\S+/g) || []).map((u) => u.replace(/uses:\s*/, '').split('@')[0]);
  h.assert(uses.length >= 2 && uses.every((u) => ['actions/setup-node', 'actions/upload-artifact', 'actions/checkout'].includes(u)), 'actions used: ' + uses.join(', '));
  h.assert(/using:\s*composite/.test(yml) && !/secrets\./.test(yml), 'a composite action with no secrets');
  yml.split('\n').filter((l) => /^\s*run:/.test(l)).forEach((l) => h.assert(!/\$\{\{/.test(l), 'no expression is pasted into a command: ' + l.trim()));
  const wf = fs.readFileSync(path.join(ROOT, 'examples', 'github', 'design-check.yml'), 'utf8');
  h.assert(/pull_request:/.test(wf) && !/pull_request_target:/.test(wf) && /contents: read/.test(wf) && /fetch-depth: 0/.test(wf), 'the example workflow is read-only on pull_request');

  const dir = workdir('action');
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const w = (name, doc) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 1)); };
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T'); git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'tmp/\nout/\n');
  w('social/launch.ledesign.json', DOC([TITLE()]));
  w('social/steady.ledesign.json', DOC([TITLE({ text: 'Steady' })]));
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  w('social/launch.ledesign.json', DOC([TITLE({ text: 'A much longer headline that will not fit in this box at all', h: 40 }), { id: 'dot', type: 'shape', shape: 'ellipse', fill: '#E0B354', x: 400, y: 250, w: 80, h: 80 }]));
  w('new.ledesign.json', DOC([TITLE({ text: 'New' })]));
  w('odd <b>|x.ledesign.json', DOC([TITLE({ text: 'Odd' })]));
  git('add', '-A'); git('commit', '-q', '-m', 'change');
  const summary = path.join(dir, 'tmp', 'summary.md'), output = path.join(dir, 'tmp', 'output.txt');
  const envs = { LE_BASE: base, LE_OUT: 'out', GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output };
  const r = await node([path.join(ACTION, 'run.js')], dir, envs);
  h.assert.equal(r.code, 1, 'problems fail the step: ' + r.stdout.slice(0, 600) + r.stderr.slice(0, 400));
  const md = fs.readFileSync(summary, 'utf8');
  h.assert(/\| `social\/launch\.ledesign\.json` \| 1 \| `social--launch\.png` \| 1 \| .*1 layer changed.*1 added/.test(md), 'summary row with previews, problems and changes:\n' + md);
  h.assert(/\| `new\.ledesign\.json` \| 1 \| `new\.png` \| none \| new \|/.test(md) && !/steady/.test(md), 'new design listed, unchanged one left out');
  h.assert(/- `overflow` `title`/.test(md), 'problems are listed');
  h.assert(!/<b>/.test(md) && /odd &lt;b&gt;\\\|x/.test(md), 'text from the pull request is escaped:\n' + md);
  h.assert(pngSize(path.join(dir, 'out', 'social--launch.png')) && pngSize(path.join(dir, 'out', 'new.png')) && !fs.existsSync(path.join(dir, 'out', 'social--steady.png')), 'pictures for the changed designs only');
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  h.assert(rep.problems === 1 && rep.designs.length === 3, 'report.json');
  h.assert(/designs=3/.test(fs.readFileSync(output, 'utf8')) && /problems=1/.test(fs.readFileSync(output, 'utf8')), 'step outputs');
  const soft = await node([path.join(ACTION, 'run.js')], dir, Object.assign({}, envs, { LE_FAIL_ON_PROBLEMS: 'false', LE_CHANGED_ONLY: 'false' }));
  h.assert(soft.code === 0 && /steady/.test(soft.stdout), 'fail-on-problems false reports only; changed-only false builds all');
  w('broken.ledesign.json', '{ "format": "localeditor-design", "version": 1, "pages": [ { "width": 100, "height": 100, "layers": [ { "type": "text", "text": "<script>x</script>" } ] } ] }');
  const br = await node([path.join(ACTION, 'run.js')], dir, Object.assign({}, envs, { LE_FILES: 'broken.ledesign.json', LE_CHANGED_ONLY: 'false', LE_FAIL_ON_PROBLEMS: 'false' }));
  h.assert(br.code === 1 && /could not be read/.test(br.stdout), 'a refused design fails the step: ' + br.stdout.slice(0, 300));
};

module.exports = cases;
