#!/usr/bin/env node
'use strict';
/* Fills tools/le-cli/site/ with the app files the engine and `localeditor serve` need, so a published package works
   without the repository. Runs from `npm pack` / `npm publish` (prepack); `--clean` removes the copy (postpack).
   The copy is never committed (tools/le-cli/.gitignore). Large optional data is left out: background-remover and
   OCR models, the onnx and tesseract runtimes, the 130 MB withicons pack, screenshots. */
const fs = require('fs');
const path = require('path');

const PKG = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG, '..', '..');
const OUT = path.join(PKG, 'site');

if (process.argv.includes('--clean')) {
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(0);
}
if (!fs.existsSync(path.join(REPO, 'studio', 'index.html'))) {
  console.error('prepack: run this from a LocalEditor checkout (studio/index.html not found at ' + REPO + ').');
  process.exit(1);
}

const SKIP_TOP = new Set(['.git', '.github', '.claude', 'node_modules', 'tests', 'scripts', 'infra', 'tools', 'labs', 'agent-kit', 'sw.js']);
const SKIP = [
  /^assets\/models\//, /^assets\/vendor\/ort/, /^assets\/vendor\/tesseract\//, /^assets\/data\/withicons\//, /^assets\/screenshots\//,
  /(^|\/)\.[^/]+$/, /\.md$/
];
const KEEP_DOCS = ['docs/FORMAT-DESIGN.md', 'docs/AGENT-CLI.md'];

let files = 0, bytes = 0;
function copy(rel) {
  const src = path.join(REPO, rel), dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  files++; bytes += fs.statSync(src).size;
}
function walk(rel) {
  for (const name of fs.readdirSync(path.join(REPO, rel))) {
    const r = rel ? rel + '/' + name : name;
    if (!rel && SKIP_TOP.has(name)) continue;
    if (!rel && name === 'docs') continue;
    const st = fs.lstatSync(path.join(REPO, r));
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { if (!SKIP.some((re) => re.test(r + '/'))) walk(r); continue; }
    if (SKIP.some((re) => re.test(r))) continue;
    copy(r);
  }
}
fs.rmSync(OUT, { recursive: true, force: true });
walk('');
KEEP_DOCS.forEach((d) => { if (fs.existsSync(path.join(REPO, d))) copy(d); });
console.log('prepack: copied ' + files + ' files (' + (bytes / 1048576).toFixed(1) + ' MB) into ' + path.relative(process.cwd(), OUT));
