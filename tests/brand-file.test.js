'use strict';
/* The brand file (brand.lebrand.json, docs/FORMAT-BRAND.md): the reader, brand lint with fixes, the design format's
   "brand" field, the studio's Brand kit import / export, the command line and the MCP tools. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'tools', 'le-cli', 'bin', 'localeditor.js');
const EXAMPLE = fs.readFileSync(path.join(ROOT, 'examples', 'brand', 'brand.lebrand.json'), 'utf8');
const BROWSER = () => require('playwright').chromium.executablePath();
const cases = {};

const OFF = (extra) => Object.assign({
  format: 'localeditor-design', version: 1, name: 'Off brand',
  pages: [{ width: 1080, height: 1080, background: '#FFF8EC', layers: [
    { id: 'title', type: 'text', text: 'Fresh today', font: 'Lobster', size: 120, color: '#E0B354', x: 80, y: 120, w: 900, h: 200 },
    { id: 'body', type: 'text', text: 'Rye and buns from 7 am.', font: 'Inter', weight: 400, size: 40, color: '#17131F', x: 80, y: 380, w: 900, h: 120 },
    { id: 'bar', type: 'shape', shape: 'rect', fill: '#FF0000', x: 80, y: 560, w: 300, h: 16 },
    { id: 'logo', type: 'icon', icon: 'lucide:cake', color: '#14213D', x: 10, y: 980, w: 80, h: 80 }
  ] }]
}, extra || {});

function workdir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'le-brand-' + tag + '-'));
  fs.mkdirSync(path.join(d, 'tmp'));
  return d;
}
function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [BIN].concat(args), { cwd, env: Object.assign({}, process.env, { LE_BROWSER: BROWSER(), TMPDIR: path.join(cwd, 'tmp'), LE_NO_OPEN: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('localeditor ' + args.join(' ') + ' timed out')); }, 80000);
    c.on('close', (code) => { clearTimeout(t); let json = null; try { json = JSON.parse(out); } catch (e) { /* text */ } resolve({ code, stdout: out, stderr: err, json }); });
  });
}
async function studio(browser, base, h) {
  const page = await h.open(browser, base, '/studio/', 'desktop');
  await page.waitForFunction(() => window.LEStudio && window.LE && window.LE.lazy);
  await h.need(page, 'design');
  await page.evaluate(() => Promise.all([LE.lazy('../assets/js/le-brand.js'), LE.lazy('../assets/js/le-link.js')]));
  await page.waitForFunction(() => window.LE.brand);
  return page;
}

cases['the reader normalises a brand and refuses markup, web addresses, paths that climb and oversized logos'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate((example) => {
    const B = LE.brand;
    const ok = B.read(example);
    const short = B.read({ format: 'localeditor-brand', colors: { primary: '#abc', text: 'rgb(0,0,0)' }, fonts: { heading: 'Anton' }, logos: ['logo.png'] });
    const bad = (o) => { const x = B.read(Object.assign({ format: 'localeditor-brand', version: 1 }, o)); return x.ok ? 'accepted' : x.errors[0].path; };
    return {
      ok: ok.ok, warnings: ok.warnings, roles: ok.brand.colors.map((c) => c.role), fonts: ok.brand.fonts, stable: B.stringify(B.read(B.stringify(ok.brand)).brand) === B.stringify(ok.brand),
      short: short.ok && short.brand.colors[0].value === '#AABBCC' && short.brand.fonts.heading.family === 'Anton' && short.brand.logos[0].src === 'logo.png',
      markup: bad({ name: 'A <script>x</script>' }), web: bad({ logos: [{ src: 'https://example.com/logo.png' }] }), climb: bad({ logos: [{ src: '../logo.png' }] }),
      big: bad({ logos: [{ src: 'data:image/png;base64,' + 'A'.repeat(400000) }] }), svg: bad({ logos: [{ src: 'data:image/svg+xml;base64,AAAA' }] }),
      proto: B.read('{"format":"localeditor-brand","__proto__":{"x":1}}').ok, colour: bad({ colors: [{ role: 'primary', value: 'url(x)' }] }),
      notBrand: B.read({ format: 'localeditor-design' }).ok, unknownFont: B.read({ format: 'localeditor-brand', fonts: { body: 'No Such Font' } }).warnings.map((w) => w.kind)
    };
  }, EXAMPLE);
  h.assert(r.ok && !r.warnings.length, 'the example brand reads cleanly: ' + JSON.stringify(r.warnings));
  h.assert.equal(r.roles.join(','), 'primary,accent,background,surface,text');
  h.assert(r.stable && r.short, 'stable output and the short form');
  h.assert.equal(r.markup, '/name'); h.assert.equal(r.web, '/logos/0/src'); h.assert.equal(r.climb, '/logos/0/src');
  h.assert.equal(r.big, '/logos/0/src'); h.assert.equal(r.svg, '/logos/0/src'); h.assert.equal(r.colour, '/colors/0/value');
  h.assert(!r.proto && !r.notBrand, 'forbidden keys and other formats are refused');
  h.assert(r.unknownFont.includes('unknown-font'), 'a font outside the library is reported');
  h.assert.noErrors(page);
};

cases['a design carries its brand (path or inline), lint reports brand problems with fixes, and the fixes settle them'] = async ({ browser, base, h }) => {
  const page = await studio(browser, base, h);
  const r = await page.evaluate(async ([off, example]) => {
    const brand = JSON.parse(example);
    const inline = await LE.design.parse(JSON.stringify(Object.assign({}, off, { brand })));
    const byRef = await LE.design.parse(JSON.stringify(Object.assign({}, off, { brand: 'brand.lebrand.json' })));
    const badRef = await LE.design.parse(JSON.stringify(Object.assign({}, off, { brand: '../brand.lebrand.json' })));
    const badInline = await LE.design.parse(JSON.stringify(Object.assign({}, off, { brand: { colors: [{ value: 'nope' }] } })));
    const w = inline.warnings.filter((x) => /^brand-/.test(x.kind));
    const fixes = LE.brand.fixes(w);
    const doc = JSON.parse(LE.design.stringify(inline.project).text);
    const fixed = LE.link.applyOps(doc, fixes);
    const again = await LE.design.parse(JSON.stringify(fixed.doc || fixed));
    const kept = LE.project.validate(JSON.parse(JSON.stringify(inline.project)));
    const explicit = LE.design.lint(byRef.project, { brand: LE.brand.read(example).brand }).filter((x) => /^brand-/.test(x.kind));
    return {
      ok: inline.ok, errors: inline.errors, kinds: w.map((x) => x.kind + ':' + (x.layer || 'page')), fixes,
      outInline: doc.brand && doc.brand.name, outRef: JSON.parse(LE.design.stringify(byRef.project).text).brand, refWarn: byRef.warnings.filter((x) => /^brand-/.test(x.kind)).length,
      badRef: badRef.ok ? 'accepted' : badRef.errors[0].path, badInline: badInline.ok ? 'accepted' : badInline.errors[0].path,
      left: again.ok ? again.warnings.filter((x) => /^brand-/.test(x.kind)).map((x) => x.kind + ':' + x.layer) : again.errors,
      keptName: kept.project.meta.studio.brand && kept.project.meta.studio.brand.data.name, explicit: explicit.length
    };
  }, [OFF(), EXAMPLE]);
  h.assert(r.ok, JSON.stringify(r.errors));
  ['brand-font:title', 'brand-contrast:title', 'brand-color:bar', 'brand-logo-size:logo', 'brand-logo-space:logo'].forEach((k) => h.assert(r.kinds.includes(k), 'expected ' + k + ' in ' + r.kinds.join(', ')));
  h.assert(!r.kinds.some((k) => /:body$/.test(k)), 'the on-brand layer is left alone: ' + r.kinds.join(', '));
  h.assert(r.fixes.find((f) => f.id === 'title').set.font === 'Anton' && r.fixes.find((f) => f.id === 'bar').set.fill, 'fixes are apply operations: ' + JSON.stringify(r.fixes));
  h.assert.equal(r.outInline, 'Harbour Bakery'); h.assert.equal(r.outRef, 'brand.lebrand.json');
  h.assert.equal(r.refWarn, 0, 'a path alone is recorded, not checked, in the browser');
  h.assert(r.explicit >= 4, 'lint takes a brand as an option');
  h.assert.equal(r.badRef, '/brand'); h.assert.equal(r.badInline, '/brand/colors/0/value');
  h.assert(Array.isArray(r.left) && !r.left.length, 'after the fixes no brand problem is left: ' + JSON.stringify(r.left));
  h.assert.equal(r.keptName, 'Harbour Bakery', 'the project sanitiser keeps the brand');
  h.assert.noErrors(page);
};

cases['Brand kit: import a brand file, export it again with roles, tone and an embedded logo'] = async ({ browser, base, h }) => {
  const page = await h.studioWithSample(browser, base, 'desktop');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#14213D'; x.fillRect(0, 0, 8, 8); return c.toDataURL('image/png'); });
  const brand = JSON.parse(EXAMPLE);
  brand.logos = [{ id: 'main', src: png, name: 'Mark', clearSpace: 0.25 }, { id: 'wide', src: 'assets/wide.png' }];
  await h.openPanel(page, 'brand');
  await page.waitForSelector('#sx-panel-body input[aria-label="Brand file"]', { state: 'attached' });
  await page.setInputFiles('#sx-panel-body input[aria-label="Brand file"]', { name: 'brand.lebrand.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(brand)) });
  await page.waitForFunction(() => /Brand file imported/.test(document.body.textContent));
  const kit = await page.evaluate(() => LE.project.brandKit());
  h.assert.equal(kit.colors.join(','), '#14213d,#e0b354,#fff8ec,#ffffff,#17131f');
  h.assert(kit.fonts.some((f) => f.role === 'heading' && f.family === 'Anton') && kit.fonts.some((f) => f.role === 'body' && f.family === 'Inter'), 'fonts by role: ' + JSON.stringify(kit.fonts));
  h.assert.equal(kit.logos.length, 1, 'the embedded logo joined the kit; the path one cannot be read in a browser');
  h.assert(/named by path/.test(await page.textContent('body')), 'says the path logo was left out');
  const dl = await h.capture(page, () => page.click('#sx-panel-body button:has-text("Export brand file")'));
  h.assert(/\.lebrand\.json$/.test(dl.name), dl.name);
  const out = JSON.parse(dl.buf.toString('utf8'));
  h.assert.equal(out.format, 'localeditor-brand');
  h.assert.equal(out.colors.map((c) => c.role).join(','), 'primary,accent,background,surface,text', 'roles survive the round trip');
  h.assert(out.tone && out.tone.includes('warm') && out.do.length === 2 && out.fonts.heading.family === 'Anton', 'tone, notes and fonts survive');
  h.assert(out.logos.length === 1 && /^data:image\/png;base64,/.test(out.logos[0].src), 'the logo is embedded');
  await page.setInputFiles('#sx-panel-body input[aria-label="Brand file"]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"localeditor-brand","name":"<img src=x onerror=alert(1)>"}') });
  await page.waitForFunction(() => /could not be read/.test(document.body.textContent));
  h.assert.equal((await page.evaluate(() => LE.project.brandKit())).colors.length, 5, 'a refused file changes nothing');
  await h.noOverflow(page);
  h.assert.noErrors(page);
};

cases['command line: brand show, brand-aware check, brand check --json with fixes, --fix, exit codes'] = async ({ h }) => {
  const dir = workdir('cli');
  fs.writeFileSync(path.join(dir, 'brand.lebrand.json'), EXAMPLE);
  fs.writeFileSync(path.join(dir, 'named.ledesign.json'), JSON.stringify(OFF({ brand: 'brand.lebrand.json' })));
  fs.writeFileSync(path.join(dir, 'plain.ledesign.json'), JSON.stringify(OFF()));
  const show = await run(['brand', 'show', 'brand.lebrand.json'], dir);
  h.assert(show.code === 0 && /Harbour Bakery/.test(show.stdout) && /primary #14213D/.test(show.stdout) && /Tone: warm/.test(show.stdout), show.stdout + show.stderr);
  fs.writeFileSync(path.join(dir, 'bad.lebrand.json'), '{"format":"localeditor-brand","colors":[{"value":"nope"}]}');
  const bad = await run(['brand', 'show', 'bad.lebrand.json', '--json'], dir);
  h.assert(bad.code === 1 && bad.json && bad.json.ok === false && /colors\/0\/value/.test(JSON.stringify(bad.json.errors)), 'a bad brand file is an error with a path: ' + bad.stdout);

  const plain = await run(['check', 'plain.ledesign.json', '--json'], dir);
  h.assert(plain.json && !plain.json.problems.some((p) => /^brand-/.test(p.kind)) && !plain.json.brand, 'no brand, no brand problems');
  const none = await run(['brand', 'check', 'plain.ledesign.json', '--json'], dir);
  h.assert(none.code === 1 && none.json.code === 'not-found', 'brand check without any brand says so: ' + none.stdout);
  const flag = await run(['lint', 'plain.ledesign.json', '--brand', 'brand.lebrand.json', '--json'], dir);
  h.assert(flag.code === 1 && flag.json.problems.some((p) => p.kind === 'brand-color' && p.layer === 'bar' && p.fix && p.fix.op === 'update'), 'lint --brand: ' + flag.stdout.slice(0, 400));
  h.assert(flag.json.problems.some((p) => p.kind === 'low-contrast'), 'ordinary problems are still listed');

  const bc = await run(['brand', 'check', 'named.ledesign.json', '--json'], dir);
  h.assert.equal(bc.code, 1);
  h.assert(bc.json.brand.name === 'Harbour Bakery' && bc.json.problems.every((p) => /^brand-/.test(p.kind)) && bc.json.fixes.length >= 3, 'brand problems only, with fixes: ' + bc.stdout.slice(0, 300));
  const fix = await run(['brand', 'check', 'named.ledesign.json', '--fix', '--json'], dir);
  h.assert(fix.code === 0 && fix.json.ok && fix.json.fixed >= 3 && !fix.json.problems.length, '--fix settles it: ' + fix.stdout.slice(0, 400));
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'named.ledesign.json'), 'utf8'));
  h.assert.equal(after.brand, 'brand.lebrand.json', 'the brand reference is written back');
  h.assert.equal(after.pages[0].layers.find((l) => l.id === 'title').font, 'Anton');
  fs.writeFileSync(path.join(dir, 'gone.ledesign.json'), JSON.stringify(OFF({ brand: 'missing.lebrand.json' })));
  const gone = await run(['check', 'gone.ledesign.json', '--json'], dir);
  h.assert(gone.code === 1 && gone.json.code === 'not-found', 'a missing brand file is reported: ' + gone.stdout.slice(0, 200));
};

cases['MCP: brand_read, brand_check with fix, design_check with a brand'] = async ({ h }) => {
  const dir = workdir('mcp');
  fs.writeFileSync(path.join(dir, 'brand.lebrand.json'), EXAMPLE);
  fs.writeFileSync(path.join(dir, 'd.ledesign.json'), JSON.stringify(OFF()));
  const c = spawn(process.execPath, [BIN, 'mcp', '--root', dir], { cwd: dir, env: Object.assign({}, process.env, { LE_BROWSER: BROWSER(), TMPDIR: path.join(dir, 'tmp') }), stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let buf = '', id = 0;
  c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch (e) { /* not ours */ } } });
  const req = (method, params) => new Promise((resolve, reject) => { const n = ++id; const t = setTimeout(() => reject(new Error('no answer to ' + method)), 80000); waiting.set(n, (m) => { clearTimeout(t); resolve(m); }); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const call = async (name, args) => { const r = await req('tools/call', { name, arguments: args }); return { isError: r.result.isError, data: JSON.parse(r.result.content[0].text) }; };
  try {
    await req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const names = (await req('tools/list', {})).result.tools.map((t) => t.name);
    h.assert(names.includes('brand_check') && names.includes('brand_read'), names.join(', '));
    const uris = (await req('resources/list', {})).result.resources.map((r) => r.uri);
    h.assert(uris.includes('localeditor://schema/brand-1.json'), 'the brand schema is a resource');
    const rd = await call('brand_read', { path: 'brand.lebrand.json' });
    h.assert(!rd.isError && rd.data.brand.colors.length === 5 && /Harbour Bakery/.test(rd.data.summary), JSON.stringify(rd.data).slice(0, 300));
    const dc = await call('design_check', { path: 'd.ledesign.json', brand: 'brand.lebrand.json' });
    h.assert(dc.data.problems.some((p) => p.kind === 'brand-font') && dc.data.brand.source === 'brand.lebrand.json', JSON.stringify(dc.data).slice(0, 300));
    const out = await call('brand_check', { path: 'd.ledesign.json', brand: '../brand.lebrand.json' });
    h.assert(out.isError && out.data.code === 'sandbox', 'a brand file outside the root is refused: ' + JSON.stringify(out.data).slice(0, 200));
    const fx = await call('brand_check', { path: 'd.ledesign.json', brand: 'brand.lebrand.json', fix: true });
    h.assert(!fx.isError && fx.data.ok && fx.data.fixed >= 3, JSON.stringify(fx.data).slice(0, 300));
  } finally {
    c.stdin.end();
    await new Promise((r) => { const t = setTimeout(() => { c.kill('SIGKILL'); r(); }, 15000); c.on('close', () => { clearTimeout(t); r(); }); });
  }
};

module.exports = cases;
