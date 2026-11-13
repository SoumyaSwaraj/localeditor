#!/usr/bin/env node
'use strict';
/* The GitHub Action's one step (see action.yml and README.md): find the designs a pull request changed, build and
   check each with the localeditor engine, write previews for the artifact and a job summary. Reads its inputs from
   LE_* environment variables. No network, no secrets, no dependencies. Run it locally the same way:
     LE_FILES='**\/*.ledesign.json' LE_CHANGED_ONLY=false node agent-kit/github-action/run.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB = path.resolve(process.env.LE_CLI_DIR || path.join(__dirname, '..', '..', 'tools', 'le-cli'), 'lib');
const { Service } = require(path.join(LIB, 'service.js'));
const B = require(path.join(LIB, 'build.js'));

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const yes = (v) => /^(1|true|yes|on)$/i.test(String(v));
const list = (v) => String(v || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
const cwd = process.cwd();

function git(args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); }
/* "**" any folders, "*" within a folder, "?" one character. */
function globRe(g) {
  const src = g.replace(/^\.\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?|\*|\?/g, (m) => (m === '?' ? '[^/]' : m === '*' ? '[^/]*' : '(?:.*/)?'));
  return new RegExp('^' + src + '$');
}
function allFiles() {
  try { return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean); } catch (e) { /* not a repository: walk */ }
  const out = [];
  (function walk(dir) {
    for (const n of fs.readdirSync(path.join(cwd, dir))) {
      if (n === 'node_modules' || n === '.git') continue;
      const r = dir ? dir + '/' + n : n;
      if (fs.statSync(path.join(cwd, r)).isDirectory()) walk(r); else out.push(r);
    }
  })('');
  return out;
}
const cell = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/`/g, '\'').slice(0, 400);
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

async function main() {
  const globs = list(env('LE_FILES', '**/*.ledesign.json')).map(globRe);
  const scripts = list(env('LE_SCRIPTS', '')).map(globRe);
  const outDir = path.resolve(cwd, env('LE_OUT', 'localeditor-previews'));
  const brand = env('LE_BRAND', '');
  const maxWarnings = Number(env('LE_MAX_WARNINGS', '0')) || 0;
  const failOn = yes(env('LE_FAIL_ON_PROBLEMS', 'true'));
  const formats = list(env('LE_FORMAT', 'png'));
  const base = env('LE_BASE', '');
  const notes = [];

  const tracked = allFiles().filter((f) => !f.startsWith(path.relative(cwd, outDir) + '/'));
  let wanted = tracked.filter((f) => globs.some((g) => g.test(f)) || scripts.some((g) => g.test(f)));
  let changed = null;
  if (yes(env('LE_CHANGED_ONLY', 'true'))) {
    if (!base) notes.push('No base commit was given, so every design was built.');
    else {
      try { changed = new Set(git(['diff', '--name-only', '-z', '--diff-filter=ACMR', base + '...HEAD']).split('\0').filter(Boolean)); }
      catch (e) { notes.push('The base commit is not in this checkout (use fetch-depth: 0), so every design was built.'); }
    }
    if (changed) {
      /* A changed brand file touches every design. */
      const brandChanged = [...changed].some((f) => /\.lebrand\.json$/.test(f));
      if (!brandChanged) wanted = wanted.filter((f) => changed.has(f));
      else notes.push('A brand file changed, so every design was checked.');
    }
  }
  /* A design a script writes is built from the script, not twice. */
  const isScript = (f) => scripts.some((g) => g.test(f));
  const generatedBy = new Set(wanted.filter(isScript).map((f) => f.replace(/\.(design\.)?[cm]?js$/i, '.ledesign.json')));
  wanted = wanted.filter((f) => isScript(f) || !generatedBy.has(f));

  const rows = [];
  let problems = 0, failed = 0;
  const svc = new Service({ browser: env('LE_BROWSER', undefined) });
  try {
    for (const file of wanted.sort()) {
      const stem = file.replace(/\.(ledesign\.json|design\.[cm]?js|json|[cm]?js)$/i, '').replace(/[\\/]+/g, '--').replace(/[^\w.-]+/g, '-');
      try {
        const r = await B.build(svc, [path.join(cwd, file)], { out: outDir, formats, brand: brand || undefined, nameFor: (d, many) => (many ? stem + '--' + d.name : stem) });
        for (const d of r.designs) {
          let change = 'new';
          const rel = path.relative(cwd, d.file).split(path.sep).join('/');
          if (base && !d.generated) {
            try {
              const old = git(['show', base + ':' + rel]);
              const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'le-base-')), path.basename(rel));
              fs.writeFileSync(tmp, old);
              const df = await svc.diff(tmp, d.file);
              const s = df.summary;
              change = df.same ? 'no visible change' : [s.layersChanged && plural(s.layersChanged, 'layer') + ' changed', s.layersAdded && s.layersAdded + ' added', s.layersRemoved && s.layersRemoved + ' removed', s.layersMoved && s.layersMoved + ' moved',
                (s.pagesAdded || s.pagesRemoved || s.pagesChanged) && plural(s.pagesAdded + s.pagesRemoved + s.pagesChanged, 'page') + ' changed'].filter(Boolean).join(', ') || 'changed';
            } catch (e) { /* not in the base commit: new */ }
          } else if (d.generated) change = 'built from ' + file;
          problems += d.problems.length;
          rows.push({ file: rel, pages: d.pages, previews: d.files.map((f) => path.basename(f.file)), problems: d.problems, change });
        }
      } catch (e) {
        failed++;
        rows.push({ file, error: e.message, errors: e.errors || [] });
      }
    }
  } finally { await svc.close(); }

  const md = ['## Design previews', ''];
  if (!rows.length) md.push('No design changed.');
  else {
    md.push('| Design | Pages | Previews | Problems | Change |', '|---|---|---|---|---|');
    rows.forEach((r) => md.push(r.error ? '| `' + cell(r.file) + '` | — | — | could not be read | — |'
      : '| `' + cell(r.file) + '` | ' + r.pages + ' | ' + r.previews.map((p) => '`' + cell(p) + '`').join(', ') + ' | ' + (r.problems.length || 'none') + ' | ' + cell(r.change) + ' |'));
    md.push('', 'The pictures are in the artifact **' + cell(env('LE_ARTIFACT', 'localeditor-previews')) + '** of this run.');
    const bad = rows.filter((r) => r.error || r.problems.length);
    if (bad.length) md.push('', '### Problems', '');
    bad.forEach((r) => {
      md.push('**' + cell(r.file) + '**', '');
      if (r.error) { md.push('- could not be read: ' + cell(r.error)); (r.errors || []).slice(1, 10).forEach((e) => md.push('- ' + cell((e.path || '') + ' ' + e.message))); }
      else r.problems.slice(0, 40).forEach((p) => md.push('- `' + cell(p.kind) + '`' + (p.layer ? ' `' + cell(p.layer) + '`' : '') + ' ' + cell(p.message)));
      if (!r.error && r.problems.length > 40) md.push('- … and ' + (r.problems.length - 40) + ' more');
      md.push('');
    });
  }
  notes.forEach((n) => md.push('', '_' + n + '_'));
  const text = md.join('\n') + '\n';
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.stdout.write(text);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ designs: rows.map((r) => ({ file: r.file, pages: r.pages, previews: r.previews, change: r.change, error: r.error, problems: (r.problems || []).map((p) => ({ kind: p.kind, layer: p.layer, path: p.path, message: p.message, fix: p.fix })) })), problems, failed }, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'designs=' + rows.length + '\nproblems=' + problems + '\nfailed=' + failed + '\npreviews=' + outDir + '\n');
  if (failed) { process.stderr.write(plural(failed, 'design') + ' could not be read.\n'); return 1; }
  if (failOn && problems > maxWarnings) { process.stderr.write(plural(problems, 'problem') + ' found (allowed: ' + maxWarnings + ').\n'); return 1; }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write('localeditor: ' + ((e && e.message) || e) + '\n'); process.exitCode = e && e.code === 'no-browser' ? 3 : 1; });
