'use strict';
/* localeditor (alias: le) — the fast path for agents and scripts. See README.md and docs/AGENT-CLI.md. */
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const HELP = {
  _: `localeditor ${pkg.version} — make and edit LocalEditor designs (.ledesign.json) from the command line.
The real editor runs in a headless Chrome, Edge or Chromium; nothing leaves this machine.

Usage: localeditor <command> [arguments] [options]      (short name: le)

Write and change
  new <file>                 Create a design  [--size 1080x1350 | --preset instagram-portrait] [--from <example|file>] [--name]
  apply <file> <ops|->       Apply operations (JSON list, file, or - for stdin)  [--dry-run] [--partial] [--if-rev] [--render out.png]
  make <maker> -o <file>     Build a design from a quick maker  --values '{"…":…}' [--style] [--size]
  convert <in> <out>         .ledesign.json <-> .leproject; --images embed|assets

Design as code
  build <file.js|file.json…> Write the designs a script exports as .ledesign.json and draw every page  [-o out/] [--format png,pdf]
  diff <a> <b>               What changed between two designs, by page and layer id  [--pixels diff.png] (exit 1 if different)

Read and check
  show <file>                Outline: pages, layers with ids, types, text, boxes  [--full]
  find <file> <query>        Layers whose id, name, text, font or type matches
  validate <file…>           Errors with JSON-pointer paths (exit 1 if any file is invalid)
  check <file…>              Problems: overflowing text, off-page layers, low contrast, missing images, unknown fonts,
                             and brand problems when the design names a brand  (exit 1 if any)  [--brand f] [--max-warnings n]
  brand check <file>         Only the brand problems, each with a fix  [--brand brand.lebrand.json] [--fix]
  brand show <brand file>    Check a brand file and print what it asks for
  render <file>              Draw a page  [--page n|id|all] [-o out.png] [--scale 1] [--format png|jpg|webp|pdf]
  catalog <kind> [query]     fonts | icons | shapes | recipes | makers | layouts | sizes | fx
                             (fx: expert effects; the query is a word, an effect id, "schema" or "actions")

Work with a person
  link <file>                Open the design in your browser, live: file changes appear in the tab, tab edits go to the file
  serve [dir]                Serve the app at http://127.0.0.1:<port>/ and a local JSON API  [--port] [--open <file>]
  mcp                        Model Context Protocol server on stdio  [--root <dir>]

  doctor                     Is a browser installed, can it render, is the network sealed?

Options for every command
  --json                     Machine-readable output on stdout
  --browser <path>           Chrome / Edge / Chromium to use (or set LE_BROWSER)
  --allow-path <dir>         Also read images from this folder (repeatable)
  --allow-host <host>        Let the engine download images from this https host (repeatable; default: none)
  --transport pipe|port      How to talk to the browser (default pipe: no debugging port at all)
  --verbose                  Engine log on stderr
  -h, --help                 Help for a command:  localeditor help apply

Exit codes: 0 ok · 1 invalid design, problems found or refused operations · 2 usage error · 3 browser or engine failure
Docs: tools/le-cli/README.md and docs/AGENT-CLI.md`,
  new: `localeditor new <file> [--size WxH | --preset <name>] [--from <example|file>] [--name <text>] [--background <colour>] [--force]
Creates a design with one empty page (default 1080x1080), or a copy of an example (hello-world, quote-card, …).
Presets: localeditor catalog sizes`,
  apply: `localeditor apply <file> <ops.json | - | '[ … ]'> [--dry-run] [--partial] [--if-rev <rev>] [--render out.png] [--label <text>]
Applies a batch of operations (the same vocabulary as LEAgent.apply in the browser) atomically: either all of them
or none. --partial keeps the ones that work. The file is written back in the normalised long form.
Examples:
  le apply post.ledesign.json '[{"op":"add","layer":{"id":"title","type":"text","text":"Hello","x":"center","y":120,"w":"80%","h":200,"fit":"shrink"}}]'
  le apply post.ledesign.json '[{"op":"update","id":"title","set":{"color":"#E0B354"}}]'
  le apply post.ledesign.json '[{"op":"remove","id":"title"}]'
Operations: add update remove reorder group ungroup align distribute page.add page.remove page.resize page.background
  page.update page.move replace rename text.replace image.fill recipe collage make note.add note.resolve doc.update
  fx.add fx.update fx.remove fx.reorder mask.set adjust.add transform.set   (expert effects: localeditor catalog fx)
  fx.call   (a helper that answers with effect operations, e.g. composite.stage, grade.preset, creative.look: localeditor catalog fx actions)
  le apply photo.ledesign.json '[{"op":"fx.add","layer":"hero","entry":{"type":"exposure","p":{"ev":0.4}}}]'`,
  render: `localeditor render <file> [--page 0|<page id>|all] [-o out.png] [--scale 1] [--format png|jpg|webp|pdf] [--transparent]
Pages are counted from 0. Several pages with -o out.png write out-0.png, out-1.png, … (PDF: one file).
Without -o the image goes to stdout when it is not a terminal, else to <design>.png.`,
  check: `localeditor check <file…> [--brand <brand.lebrand.json>] [--max-warnings n]      (also: localeditor lint)
Lists problems (overflow, clipped, off-page, missing-image, unknown-font, low-contrast, unknown-icon, remote-image …)
with JSON pointers and layer ids. When the design names a brand ("brand": "brand.lebrand.json" or an inline block) or
--brand is given, brand problems are listed too (brand-color, brand-font, brand-contrast, brand-logo-space,
brand-logo-size), each with a "fix" operation in --json. Exit 1 when a file has more than --max-warnings (default 0).`,
  build: `localeditor build <poster.design.js | poster.ledesign.json …> [-o out/] [--format png|jpg|webp|pdf[,…]] [--scale 1] [--brand <file>]
A .js file is run with Node and exports designs made with the builder (require('localeditor/dsl')): one design,
a list, an object of name: design, or a function returning those. Each is written next to the script as
<name>.ledesign.json — plain data, the same open format, nothing in it is run when it is opened. Every page of
every design is then drawn into the output folder (default out/): <name>.png, or <name>-<page>.png for several pages.
Problems are listed; add "localeditor check" for a failing exit code. Guide: docs/DESIGN-AS-CODE.md`,
  diff: `localeditor diff <a.ledesign.json> <b.ledesign.json> [--pixels diff.png] [--page n]
Lists pages and layers added, removed, moved and changed (with the fields and their old and new values), matched by
id, so a renamed colour is one line and not a wall of JSON. --pixels also draws both and writes a picture per page
with the differing pixels marked. --json adds the operation list that turns a into b. Exit 0 when the same, 1 when not.`,
  brand: `localeditor brand check <design> [--brand <brand.lebrand.json>] [--fix]
localeditor brand show <brand.lebrand.json>
check lists where a design leaves its brand: colours outside the palette, fonts outside the brand, text that is hard to
read on a brand colour, logos that are too small or too close to something. --json adds "fixes": an operation list you
can pass to apply; --fix applies it and checks again. Exit 1 while problems remain.
show checks a brand file and prints its colours, fonts, logos, tone and do / don't lines. Format: docs/FORMAT-BRAND.md`,
  validate: 'localeditor validate <file…>   (- reads stdin)\nRefuses unsafe or malformed files with { path, message } errors.',
  show: 'localeditor show <file> [--full]\nAn outline of pages and layers; --full prints the normalised file.',
  find: 'localeditor find <file> <query>\nLayers whose id, name, type, text, font or image path contains the query.',
  catalog: 'localeditor catalog fonts|icons|shapes|recipes|makers|layouts|sizes|fx [query]\nfx lists the expert effects; "catalog fx <effect id>" prints one in full (parameters, ranges, an example entry), "catalog fx schema" the blends, mask kinds and limits.',
  make: `localeditor make <maker-id> -o <file> --values '<json>' [--style <id>] [--size <id>] [--force]
See the makers and their inputs: localeditor catalog makers`,
  convert: 'localeditor convert <in> <out> [--images embed|assets] [--force]\n.ledesign.json -> .leproject, .leproject -> .ledesign.json, or embedded images <-> an assets/ folder.',
  link: `localeditor link <file> [--port n] [--no-open]
Serves the app on 127.0.0.1 and opens your browser with the design. The tab follows the file; your edits in the tab
are written to the file; after every sync <name>.le/status.json and <name>.le/preview-<page>.png are written.
Stops with Ctrl+C.

localeditor link <file> --attach <api address> [--tool <name>] [--timeout 120]
Asks a server that is already running ("localeditor serve" printed its API address) to show the file in a tab that
is already open. The person is asked in that tab: Allow once, Allow for this session, or Refuse. The command waits
and exits 0 when allowed, else 1 with a code: consent-refused, consent-cancelled, consent-timeout (nobody answered),
consent-tab-closed, consent-no-tab (no tab is open; the answer carries the address to open).`,
  serve: `localeditor serve [dir] [--port n] [--open <file>] [--token <t>]
The app for people at http://127.0.0.1:<port>/ and a JSON API for agents under /api/<token>/ (printed once).
Only files under dir (default: the current folder) can be used.`,
  mcp: `localeditor mcp [--root <dir>]
A Model Context Protocol server on stdio. Only files under --root (default: the current folder) can be read or written.
Setup for Claude Code, Cursor, Codex, OpenCode and Gemini CLI: agent-kit/mcp/README.md`,
  doctor: 'localeditor doctor\nChecks Node, finds a browser, starts it headless, renders the hello-world example and proves the network seal.'
};

const BOOL = new Set(['json', 'dry-run', 'partial', 'full', 'force', 'verbose', 'help', 'transparent', 'no-open', 'quiet', 'h', 'all', 'no-previews', 'exit-on-stdin-end', 'fix']);
const MULTI = new Set(['allow-path', 'allow-host']);
const SHORT = { o: 'out', h: 'help' };

function parseArgs(argv) {
  const args = { _: [], 'allow-path': [], 'allow-host': [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args._.push(...argv.slice(i + 1)); break; }
    if (a === '-') { args._.push(a); continue; }
    let m = /^--([a-z][\w-]*)(?:=(.*))?$/i.exec(a) || /^-([a-z])$/i.exec(a);
    if (!m) { args._.push(a); continue; }
    let key = m[1];
    if (SHORT[key] && a.length === 2) key = SHORT[key];
    let val = m[2];
    if (BOOL.has(key)) { args[key] = val == null ? true : !/^(0|false|no)$/i.test(val); continue; }
    if (val == null) {
      if (i + 1 >= argv.length) throw usage('--' + key + ' needs a value.');
      val = argv[++i];
    }
    if (MULTI.has(key)) args[key].push(val); else args[key] = val;
  }
  return args;
}
function usage(msg) { const e = new Error(msg); e.code = 'usage'; return e; }

function out(args, obj, human) {
  if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  else if (human) process.stdout.write(human(obj) + '\n');
}
const tty = (s) => (process.stdout.isTTY ? s : s);

function readOps(src) {
  if (src == null) throw usage('Give the operations: a JSON file, - for stdin, or inline JSON.');
  let text;
  if (src === '-') text = fs.readFileSync(0, 'utf8');
  else if (/^\s*[[{]/.test(src)) text = src;
  else {
    try { text = fs.readFileSync(src, 'utf8'); } catch (e) { throw usage('Could not read the operations file ' + src + '.'); }
  }
  try { return JSON.parse(text); } catch (e) { const err = new Error('The operations are not valid JSON: ' + e.message); err.code = 'invalid'; err.errors = [{ path: '/ops', message: err.message }]; throw err; }
}

function fmtProblems(list) {
  if (!list || !list.length) return '  no problems';
  return list.map((p) => '  ' + (p.kind || 'problem').padEnd(14) + ' ' + (p.layer ? '[' + p.layer + '] ' : '') + p.message + (p.path ? '  (' + p.path + ')' : '')).join('\n');
}
function fmtErrors(list) { return (list || []).map((e) => '  ' + (e.path || '/') + ': ' + e.message).join('\n'); }
function fmtOutline(o) {
  const lines = [(o.outline.name ? '"' + o.outline.name + '"  ' : '') + 'rev ' + o.rev + (o.mode ? '  (' + o.mode + ')' : '')];
  o.outline.pages.forEach((p) => {
    lines.push('page ' + p.index + (p.id ? ' "' + p.id + '"' : '') + '  ' + p.width + '×' + p.height + (p.background ? '  background ' + p.background : '') + '  ' + p.layers.length + ' layer' + (p.layers.length === 1 ? '' : 's'));
    p.layers.forEach((l) => {
      const what = l.type === 'text' ? JSON.stringify(l.text.length > 50 ? l.text.slice(0, 50) + '…' : l.text) + (l.font ? ' ' + l.font : '') + (l.size ? ' ' + l.size + 'px' : '')
        : l.type === 'image' ? l.photo : l.shape || l.icon || '';
      lines.push('  ' + String(l.id).padEnd(18) + ' ' + String(l.type).padEnd(6) + ' ' + [l.x, l.y].map((v) => v == null ? '?' : Math.round(v)).join(',') + ' ' + [l.w, l.h].map((v) => v == null ? '?' : Math.round(v)).join('×') + '  ' + what + (l.hidden ? ' (hidden)' : '') + (l.locked ? ' (locked)' : ''));
    });
  });
  if (o.outline.notes && o.outline.notes.length) { lines.push('notes'); o.outline.notes.forEach((n) => lines.push('  ' + n.id + ' [' + n.status + ']' + (n.layer ? ' on ' + n.layer : '') + ': ' + n.text)); }
  if (o.problems && o.problems.length) lines.push('problems', fmtProblems(o.problems));
  return lines.join('\n');
}

async function withService(args, fn) {
  const { Service } = require('./service');
  const svc = new Service({
    browser: args.browser, transport: args.transport, allowHosts: args['allow-host'], allowPaths: args['allow-path'], verbose: !!args.verbose,
    adapter: args.adapter || process.env.LE_CLI_ADAPTER
  });
  try { return await fn(svc); } finally { await svc.close(); }
}

const COMMANDS = {
  async new(args) {
    const file = args._[0];
    if (!file) throw usage('localeditor new <file>');
    return withService(args, async (svc) => {
      const r = await svc.newDesign(file, { size: args.size, preset: args.preset, from: args.from, name: args.name, background: args.background, force: args.force });
      out(args, r, (x) => 'Created ' + path.relative(process.cwd(), x.file) + ' (rev ' + x.rev + ')');
      return 0;
    });
  },
  async validate(args) {
    if (!args._.length) throw usage('localeditor validate <file…>');
    return withService(args, async (svc) => {
      const r = await svc.validate(args._);
      out(args, r, (x) => x.files.map((f) => (f.ok ? 'ok    ' : 'error ') + f.file + (f.ok ? (f.problems.length ? '  (' + f.problems.length + ' problem' + (f.problems.length > 1 ? 's' : '') + '; run check)' : '') : '\n' + fmtErrors(f.errors))).join('\n'));
      return r.ok ? 0 : 1;
    });
  },
  async check(args) {
    const files = args._;
    if (!files.length) throw usage('localeditor check <file…>');
    const max = args['max-warnings'] != null ? Number(args['max-warnings']) : 0;
    const human = (x) => (x.problems.length ? x.problems.length + ' problem' + (x.problems.length > 1 ? 's' : '') + ' in ' + path.relative(process.cwd(), x.file) + '\n' + fmtProblems(x.problems) : 'No problems in ' + path.relative(process.cwd(), x.file)) + (x.brand ? '\n  (brand: ' + (x.brand.name || 'inline') + ')' : '');
    return withService(args, async (svc) => {
      const all = [];
      for (const file of files) {
        const r = await svc.check(file, { brand: args.brand });
        r.maxWarnings = max;
        r.ok = r.problems.length <= max;
        all.push(r);
      }
      if (all.length === 1) out(args, all[0], human);
      else out(args, { ok: all.every((r) => r.ok), files: all }, (x) => x.files.map(human).join('\n'));
      return all.every((r) => r.ok) ? 0 : 1;
    });
  },
  async lint(args) { return COMMANDS.check(args); },
  async build(args) {
    if (!args._.length) throw usage('localeditor build <file.js|file.json…> [-o out/]');
    const B = require('./build');
    return withService(args, async (svc) => {
      const r = await B.build(svc, args._, { out: args.out, formats: args.format ? String(args.format).split(',') : null, scale: args.scale, brand: args.brand, quality: args.quality ? Number(args.quality) : undefined });
      const rel = (f) => path.relative(process.cwd(), f);
      out(args, r, (x) => x.designs.map((d) => (d.generated ? 'Wrote ' + rel(d.file) + '\n' : '') + d.files.map((f) => 'Wrote ' + rel(f.file) + (f.width ? ' (' + f.width + '×' + f.height + ')' : '')).join('\n') +
        (d.problems.length ? '\n' + d.problems.length + ' problem' + (d.problems.length > 1 ? 's' : '') + ' in ' + rel(d.file) + '\n' + fmtProblems(d.problems) : '')).join('\n'));
      return 0;
    });
  },
  async diff(args) {
    const [a, b] = args._;
    if (!a || !b) throw usage('localeditor diff <a> <b> [--pixels diff.png]');
    const B = require('./build');
    const want = args.pixels === true ? 'diff.png' : args.pixels;
    return withService(args, async (svc) => {
      const r = await svc.diff(a, b, { pixels: !!want, page: args.page });
      if (r.pixels) {
        r.pixels.forEach((p) => {
          const target = svc.sandbox.file(r.pixels.length > 1 ? String(want).replace(/(\.png)?$/i, '-' + p.page + '.png') : String(want), 'the output');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, Buffer.from(p.data, 'base64'));
          p.file = target; delete p.data;
        });
      }
      out(args, r, (x) => B.describeText(x) + (x.pixels ? '\n' + x.pixels.map((p) => 'page ' + p.page + ': ' + (p.changed ? (p.share * 100).toFixed(2) + ' % of the pixels differ' : 'pixels are the same') + '  → ' + path.relative(process.cwd(), p.file)).join('\n') : ''));
      return r.same ? 0 : 1;
    });
  },
  async brand(args) {
    const sub = args._.shift();
    const file = args._[0];
    if ((sub !== 'check' && sub !== 'show') || !file) throw usage('localeditor brand check <design> [--brand <file>] [--fix]  |  localeditor brand show <brand file>');
    return withService(args, async (svc) => {
      if (sub === 'show') {
        const b = await svc.brandRead(file);
        out(args, b, (x) => x.summary + (x.warnings.length ? '\n' + fmtProblems(x.warnings) : ''));
        return 0;
      }
      const r = await svc.brandCheck(file, { brand: args.brand, fix: args.fix });
      out(args, r, (x) => (x.fixed != null ? x.fixed + ' fix' + (x.fixed === 1 ? '' : 'es') + ' applied\n' : '') +
        (x.problems.length ? x.problems.length + ' brand problem' + (x.problems.length > 1 ? 's' : '') + ' in ' + path.relative(process.cwd(), x.file) + ' (brand: ' + x.brand.name + ')\n' + fmtProblems(x.problems) + (x.fixes.length ? '\n' + x.fixes.length + ' can be fixed: add --fix, or --json for the operations' : '')
          : path.relative(process.cwd(), x.file) + ' follows the brand ' + x.brand.name + '.'));
      return r.ok ? 0 : 1;
    });
  },
  async render(args) {
    const file = args._[0];
    if (!file) throw usage('localeditor render <file> [-o out.png]');
    let format = args.format;
    if (!format && args.out) { const m = /\.(png|jpe?g|webp|pdf)$/i.exec(args.out); if (m) format = m[1].toLowerCase().replace('jpeg', 'jpg'); }
    format = (format || 'png').toLowerCase().replace('jpeg', 'jpg');
    return withService(args, async (svc) => {
      const r = await svc.render(file, { page: args.page, scale: args.scale, format, transparent: args.transparent, quality: args.quality ? Number(args.quality) : undefined });
      let target = args.out;
      if (!target && !process.stdout.isTTY && !args.json && r.pages.length === 1) { process.stdout.write(Buffer.from(r.pages[0].data, 'base64')); return 0; }
      if (!target) target = file.replace(/\.ledesign\.json$|\.json$/i, '') + '.' + (format === 'jpg' ? 'jpg' : format);
      const files = svc.writeRender(r, target, format);
      out(args, { ok: true, files, ms: r.ms }, (x) => x.files.map((f) => 'Wrote ' + path.relative(process.cwd(), f.file) + (f.width ? ' (' + f.width + '×' + f.height + ')' : '')).join('\n'));
      return 0;
    });
  },
  async apply(args) {
    const file = args._[0];
    if (!file) throw usage('localeditor apply <file> <ops.json | ->');
    const ops = readOps(args._[1]);
    return withService(args, async (svc) => {
      const r = await svc.apply(file, ops, { dryRun: args['dry-run'], partial: args.partial, ifRev: args['if-rev'], label: args.label });
      if (args.render) {
        const rr = await svc.render(file, { page: args.page, format: /\.(jpe?g)$/i.test(args.render) ? 'jpg' : /\.webp$/i.test(args.render) ? 'webp' : 'png' });
        r.rendered = svc.writeRender(rr, args.render, 'png');
      }
      out(args, r, (x) => {
        const head = (x.dryRun ? 'Dry run: ' : '') + x.applied + ' operation' + (x.applied === 1 ? '' : 's') + ' applied' + (x.written ? ', written' : (x.dryRun ? '' : ', file unchanged')) + ' (rev ' + x.rev + ', ' + x.ms + ' ms)';
        const failed = x.failed ? '\nskipped:\n' + fmtErrors(x.failed) : '';
        const np = x.newProblems && x.newProblems.length ? '\nnew problems:\n' + fmtProblems(x.newProblems) : '';
        const ren = x.rendered ? '\n' + x.rendered.map((f) => 'Wrote ' + path.relative(process.cwd(), f.file)).join('\n') : '';
        return head + failed + np + ren;
      });
      return r.failed ? 1 : 0;
    });
  },
  async show(args) {
    const file = args._[0];
    if (!file) throw usage('localeditor show <file>');
    return withService(args, async (svc) => {
      const r = await svc.show(file, { full: args.full });
      out(args, r, (x) => (x.text != null ? x.text.replace(/\n$/, '') : fmtOutline(x)));
      return 0;
    });
  },
  async find(args) {
    const [file, ...q] = args._;
    if (!file) throw usage('localeditor find <file> <query>');
    return withService(args, async (svc) => {
      const r = await svc.find(file, q.join(' '));
      out(args, r, (x) => x.matches.length ? x.matches.map((m) => 'page ' + m.page + '  ' + String(m.id).padEnd(18) + ' ' + m.type + (m.text ? '  ' + JSON.stringify(m.text) : '') + '  ' + m.path).join('\n') : 'No layer matches "' + x.query + '".');
      return r.matches.length ? 0 : 1;
    });
  },
  async catalog(args) {
    const [kind, ...q] = args._;
    if (!kind) throw usage('localeditor catalog fonts|icons|shapes|recipes|makers|layouts|sizes|fx [query]');
    return withService(args, async (svc) => {
      const r = await svc.catalog(kind, q.join(' '), { limit: args.limit ? Number(args.limit) : 60 });
      out(args, r, (x) => {
        if (x.effect || x.schema || x.actions) return JSON.stringify(x.effect || x.schema || x.actions, null, 1);
        const items = x.items || [];
        const line = (i) => kind === 'fonts' ? i.family + '  (' + i.category + '; ' + i.weights.join(', ') + ')'
          : kind === 'sizes' ? i.preset.padEnd(28) + ' ' + i.width + '×' + i.height + '  ' + i.group
          : kind === 'makers' ? i.id.padEnd(20) + ' ' + i.name + ' — ' + i.summary + '\n      inputs: ' + i.inputs.map((n) => n.key + ':' + n.type + (n.required ? '*' : '')).join(', ') + '\n      styles: ' + i.styles.join(', ') + '; sizes: ' + i.sizes.join(', ')
          : kind === 'recipes' ? i.id.padEnd(22) + ' ' + i.name
          : kind === 'fx' || kind === 'effects' ? i.id.padEnd(24) + ' ' + i.section.padEnd(16) + ' ' + i.summary
          : kind === 'layouts' ? i.id.padEnd(10) + ' ' + i.cells + ' photos'
          : (i.id || i.name) + (i.name && i.id ? '  ' + i.name : '') + (i.count ? '  (' + i.count + ')' : '');
        return items.map(line).join('\n') + (x.hint ? '\n' + x.hint : '') + (x.templates && x.templates.length ? '\ncollage styles: ' + x.templates.slice(0, 30).map((t) => t.template).join(', ') + (x.templates.length > 30 ? ' …' : '') : '');
      });
      return 0;
    });
  },
  async make(args) {
    const id = args._[0];
    if (!id || !args.out) throw usage('localeditor make <maker-id> -o <file> --values <json>');
    let values = {};
    if (args.values) { try { values = JSON.parse(/^\s*\{/.test(args.values) ? args.values : fs.readFileSync(args.values, 'utf8')); } catch (e) { throw usage('--values is a JSON object (or a file with one): ' + e.message); } }
    return withService(args, async (svc) => {
      const r = await svc.make(id, values, args.out, { style: args.style, size: args.size, force: args.force });
      out(args, r, (x) => 'Made ' + path.relative(process.cwd(), x.file) + ' with ' + x.maker + (x.problems.length ? '\n' + fmtProblems(x.problems) : ''));
      return 0;
    });
  },
  async convert(args) {
    const [a, b] = args._;
    if (!a || !b) throw usage('localeditor convert <in> <out>');
    return withService(args, async (svc) => {
      const r = await svc.convert(a, b, { images: args.images, force: args.force });
      out(args, r, (x) => 'Wrote ' + path.relative(process.cwd(), x.to) + (x.assets && x.assets.length ? ' and ' + x.assets.length + ' image' + (x.assets.length > 1 ? 's' : '') : ''));
      return 0;
    });
  },
  async doctor(args) {
    return withService(args, async (svc) => {
      const r = await svc.doctor();
      out(args, r, (x) => ['localeditor ' + pkg.version + ' · Node ' + x.node + ' · ' + x.platform].concat(x.checks.map((c) => (c.ok ? 'ok    ' : 'FAIL  ') + c.name + (c.detail ? '\n      ' + c.detail : ''))).join('\n') + (x.ok ? '\nAll good.' : ''));
      return r.ok ? 0 : 3;
    });
  },
  async link(args) { return require('./serve').link(args); },
  async serve(args) { return require('./serve').serve(args); },
  async mcp(args) { return require('./mcp').run(args); }
};

async function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(e.message + '\n'); return 2; }
  let cmd = args._.shift();
  if (cmd === 'help') { const t = args._[0]; process.stdout.write((HELP[t] || HELP._) + '\n'); return 0; }
  if (args.version || cmd === 'version' || cmd === '--version') { process.stdout.write(pkg.version + '\n'); return 0; }
  if (!cmd || args.help) { process.stdout.write((HELP[cmd] || HELP._) + '\n'); return cmd || args.help ? 0 : 2; }
  if (!COMMANDS[cmd]) { process.stderr.write('Unknown command "' + cmd + '". Run: localeditor --help\n'); return 2; }
  try {
    return await COMMANDS[cmd](args);
  } catch (e) {
    const code = e.code === 'usage' ? 2 : (e.code === 'no-browser' || e.code === 'no-site' || /browser|engine|editor did not/i.test(e.message || '') && !e.errors ? 3 : 1);
    if (args.json) process.stdout.write(JSON.stringify({ ok: false, code: e.code || 'error', message: e.message, errors: e.errors || [{ path: '', message: e.message }], results: e.results }, null, 2) + '\n');
    else {
      process.stderr.write((e.code === 'usage' ? 'Usage: ' : 'Error' + (e.code && e.code !== 'invalid' ? ' (' + e.code + ')' : '') + ': ') + e.message + '\n');
      if (e.errors && e.errors.length > 1) process.stderr.write(fmtErrors(e.errors.slice(0, 20)) + '\n');
      if (e.code === 'usage') process.stderr.write('Run: localeditor help ' + (cmd || '') + '\n');
    }
    return code;
  }
}

module.exports = { main, parseArgs, HELP };
