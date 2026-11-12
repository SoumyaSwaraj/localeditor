#!/usr/bin/env node
/* Builds the LocalEditor font library from npm (Fontsource packages of the Google Fonts catalogue).
   Reproducible: package versions and tarball hashes are pinned in scripts/fonts/lock.json.
   See docs/FONTS.md for the whole picture.

     node scripts/fetch-fonts.js                 library + manifest (assets/fonts/library, assets/data/fonts-*.json)
     node scripts/fetch-fonts.js --previews      name-only preview subsets (needs Python with fontTools, see FONTS.md)
     node scripts/fetch-fonts.js --cjk           Chinese, Japanese and Korean families into assets/fonts/cjk/ (git-ignored;
                                                 scripts/deploy.sh uploads it when present)
     node scripts/fetch-fonts.js --lock          re-resolve the newest package versions and rewrite lock.json
     node scripts/fetch-fonts.js --popularity    refresh scripts/fonts/popularity.json (npm monthly downloads)
     node scripts/fetch-fonts.js --index         only regenerate the manifest from files already on disk
     --only "Inter,Lora"                         limit a run to some families (manifest is still written for all)

   Only OFL-1.1, Apache-2.0, MIT, BSD and ISC are accepted, and only when the package's own metadata, package.json
   and LICENSE text agree. Fonts are copied byte for byte (no renaming, no modification). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'assets', 'fonts', 'library');
const CJK_DIR = path.join(ROOT, 'assets', 'fonts', 'cjk');
const ORIGINALS = path.join(ROOT, 'assets', 'fonts', 'originals');
const PREVIEWS = path.join(ROOT, 'assets', 'fonts', 'previews');
const DATA = path.join(ROOT, 'assets', 'data');
const HERE = path.join(ROOT, 'scripts', 'fonts');
const LOCK = path.join(HERE, 'lock.json');
const POP = path.join(HERE, 'popularity.json');
const JS = path.join(ROOT, 'assets', 'js', 'le-fonts.js');
const REGISTRY = 'https://registry.npmjs.org/';

const ALLOWED = ['OFL-1.1', 'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'];
/* Subsets we ship. cyrillic-ext, greek-ext, math, symbols and rarer scripts are left out to keep the library light. */
const SUBSETS = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'greek', 'devanagari', 'bengali', 'tamil', 'telugu', 'gujarati',
  'gurmukhi', 'kannada', 'malayalam', 'arabic', 'hebrew', 'thai'];
/* Subset -> script id (the picker's Language filter). */
const SCRIPT_OF = { latin: 'latin', 'latin-ext': 'latin', vietnamese: 'vietnamese', cyrillic: 'cyrillic', greek: 'greek',
  devanagari: 'devanagari', bengali: 'bengali', tamil: 'tamil', telugu: 'telugu', gujarati: 'gujarati', gurmukhi: 'gurmukhi',
  kannada: 'kannada', malayalam: 'malayalam', arabic: 'arabic', hebrew: 'hebrew', thai: 'thai',
  japanese: 'japanese', korean: 'korean', 'chinese-simplified': 'chinese-simplified', 'chinese-traditional': 'chinese-traditional' };

const args = process.argv.slice(2);
const flag = (n) => args.indexOf('--' + n) >= 0;
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('only') ? opt('only').split(',').map((s) => s.trim().toLowerCase()) : null;
const TMP = process.env.LE_FONTS_TMP || path.join(os.tmpdir(), 'le-fonts-' + process.pid);

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, v, pretty) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, pretty ? JSON.stringify(v, null, 1) + '\n' : JSON.stringify(v)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function families() {
  delete require.cache[require.resolve('./fonts/families.js')];
  const rows = require('./fonts/families.js');
  const firstScriptRow = rows.findIndex((r) => r[0] === 'Noto Sans Devanagari');
  return rows.map(function (r, i) {
    const flags = (r[4] || '').split(/\s+/).filter(Boolean);
    const cjk = flags.indexOf('cjk') >= 0;
    return { family: r[0], id: slugify(r[0]), style: r[1], kind: r[2], feel: r[3].split(/\s+/).filter(Boolean), italic: flags.indexOf('i') >= 0, cjk: cjk,
      scriptFirst: !cjk && (flags.indexOf('s') >= 0 || (firstScriptRow >= 0 && i >= firstScriptRow)) };
  });
}

async function getJSON(url) {
  for (let t = 0; t < 6; t++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
    } catch (e) { /* retry */ }
    await sleep(800 * (t + 1));
  }
  throw new Error('failed ' + url);
}
async function getBuf(url) {
  for (let t = 0; t < 6; t++) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (e) { /* retry */ }
    await sleep(800 * (t + 1));
  }
  throw new Error('failed ' + url);
}

/* ---------- Lock: which package and version each family comes from ---------- */
async function resolveStatic(f) {
  const s = await getJSON(REGISTRY + '@fontsource%2F' + f.id + '/latest');
  if (!s) return null;
  return { pkg: '@fontsource/' + f.id, version: s.version, tarball: s.dist.tarball, integrity: s.dist.integrity, variable: false };
}
async function resolve(f) {
  const v = await getJSON(REGISTRY + '@fontsource-variable%2F' + f.id + '/latest');
  if (v && v.version) {
    const meta = await getJSON(REGISTRY + '@fontsource-variable%2F' + f.id + '/' + v.version);
    return { pkg: '@fontsource-variable/' + f.id, version: v.version, tarball: meta.dist.tarball, integrity: meta.dist.integrity, variable: true };
  }
  return resolveStatic(f);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function lane() { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }
  await Promise.all(Array.from({ length: n }, lane));
  return out;
}

/* ---------- Unpacking ---------- */
async function unpack(entry, name) {
  const buf = await getBuf(entry.tarball);
  const [algo, want] = entry.integrity.split('-');
  const got = crypto.createHash(algo).update(buf).digest('base64');
  if (got !== want) throw new Error('integrity mismatch for ' + entry.pkg + '@' + entry.version);
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tgz = path.join(dir, 'p.tgz');
  fs.writeFileSync(tgz, buf);
  cp.execFileSync('tar', ['xzf', tgz, '-C', dir]);
  fs.unlinkSync(tgz);
  return path.join(dir, 'package');
}

function parseCss(css) {
  const faces = [];
  css.replace(/@font-face\s*{([^}]*)}/g, function (_, body) {
    const g = (re) => { const m = re.exec(body); return m ? m[1].trim() : ''; };
    faces.push({ style: g(/font-style:\s*([^;]+);/), weight: g(/font-weight:\s*([^;]+);/), src: g(/url\(([^)]+\.woff2)\)/), range: g(/unicode-range:\s*([^;]+);/) });
    return '';
  });
  return faces;
}

/* ---------- Licence check: metadata, package.json and LICENSE text must agree ---------- */
function licence(pkgDir) {
  const meta = readJSON(path.join(pkgDir, 'metadata.json'), {});
  const pj = readJSON(path.join(pkgDir, 'package.json'), {});
  const text = fs.existsSync(path.join(pkgDir, 'LICENSE')) ? fs.readFileSync(path.join(pkgDir, 'LICENSE'), 'utf8') : '';
  const type = meta.license && meta.license.type;
  let fromText = null;
  if (/SIL OPEN FONT LICENSE\s+Version 1\.1/i.test(text)) fromText = 'OFL-1.1';
  else if (/Apache License[\s\S]{0,40}Version 2\.0/i.test(text)) fromText = 'Apache-2.0';
  else if (/Permission is hereby granted, free of charge/i.test(text)) fromText = 'MIT';
  if (!fromText) throw new Error('licence text not recognised');
  if (ALLOWED.indexOf(type) < 0) throw new Error('metadata licence not allowed: ' + type);
  if (type !== fromText) throw new Error('metadata says ' + type + ' but LICENSE text is ' + fromText);
  if (ALLOWED.indexOf(pj.license) < 0) throw new Error('package.json licence not allowed: ' + pj.license);
  if (/ubuntu font licen/i.test(text)) throw new Error('Ubuntu Font Licence');
  return { license: type, copyright: (meta.license.attribution || '').trim(), text: text, meta: meta };
}

/* ---------- One family ---------- */
function pickStatic(weights) {
  const has = (w) => weights.indexOf(w) >= 0;
  const regular = has(400) ? 400 : weights.reduce((a, b) => Math.abs(b - 400) < Math.abs(a - 400) ? b : a, weights[0]);
  let bold = has(700) ? 700 : weights.filter((w) => w >= 600).sort((a, b) => a - b)[0];
  const out = [regular];
  if (bold && bold !== regular) out.push(bold);
  return out;
}

async function buildFamily(f, entry, outDir, subsetsWanted) {
  const pkgDir = await unpack(entry, f.id);
  const lic = licence(pkgDir);
  const meta = lic.meta;
  const faces = []; /* { key, weight: '400' | '100 900', italic, files: { subset: srcFile }, ranges } */
  const axis = meta.variable && meta.variable.wght;
  const hasItalic = (meta.styles || []).indexOf('italic') >= 0;
  if (entry.variable && axis) {
    const variants = [['v', false, 'wght.css']];
    if (f.italic && hasItalic && fs.existsSync(path.join(pkgDir, 'wght-italic.css'))) variants.push(['vi', true, 'wght-italic.css']);
    variants.forEach(function (v) {
      const css = parseCss(fs.readFileSync(path.join(pkgDir, v[2]), 'utf8'));
      const face = { key: v[0], weight: axis.min + ' ' + axis.max, italic: v[1], files: {}, ranges: {} };
      css.forEach(function (c) {
        const m = /-([a-z0-9-]+|\[\d+\]|\d+)-wght-(normal|italic)\.woff2$/.exec(c.src);
        const subset = c.src.replace(/^\.\/files\//, '').replace(f.id + '-', '').replace(/-wght-(normal|italic)\.woff2$/, '');
        if (!m) return;
        face.files[subset] = path.join(pkgDir, c.src);
        face.ranges[subset] = c.range;
      });
      faces.push(face);
    });
  } else if (!entry.variable || !axis) {
    if (entry.variable && !axis) { const e = new Error('variable package without a weight axis'); e.noWeightAxis = true; throw e; }
    const weights = pickStatic(meta.weights || [400]);
    const styles = [false];
    if (f.italic && hasItalic) styles.push(true);
    styles.forEach(function (it) {
      weights.forEach(function (w) {
        const cssFile = path.join(pkgDir, w + (it ? '-italic' : '') + '.css');
        if (!fs.existsSync(cssFile)) return;
        const face = { key: String(w) + (it ? 'i' : ''), weight: String(w), italic: it, files: {}, ranges: {} };
        parseCss(fs.readFileSync(cssFile, 'utf8')).forEach(function (c) {
          const subset = c.src.replace(/^\.\/files\//, '').replace(f.id + '-', '').replace(new RegExp('-' + w + '-(normal|italic)\\.woff2$'), '');
          face.files[subset] = path.join(pkgDir, c.src);
          face.ranges[subset] = c.range;
        });
        faces.push(face);
      });
    });
  }
  if (!faces.length) throw new Error('no faces');
  /* Subsets to ship: the wanted ones that the regular face has. */
  const main = faces[0];
  const subsets = Object.keys(main.files).filter((s) => !subsetsWanted || subsetsWanted.indexOf(s) >= 0);
  if (!subsets.length) throw new Error('no shippable subsets in ' + Object.keys(main.files).join(','));
  /* Content revision: changes whenever any shipped byte changes (files are served as immutable). */
  const h = crypto.createHash('sha1');
  faces.forEach((face) => subsets.forEach((s) => { if (face.files[s]) h.update(fs.readFileSync(face.files[s])); }));
  const rev = h.digest('hex').slice(0, 6);
  const dir = path.join(outDir, f.id);
  fs.mkdirSync(dir, { recursive: true });
  /* Remove files from older runs (keeps the legacy .woff files the PDF path still reads). */
  fs.readdirSync(dir).forEach(function (name) { if (/\.woff2$/.test(name)) fs.unlinkSync(path.join(dir, name)); });
  const sizes = {};
  let bytes = 0;
  const missing = {};
  faces.forEach(function (face) {
    subsets.forEach(function (s) {
      if (!face.files[s]) { (missing[face.key] = missing[face.key] || []).push(s); return; }
      const name = f.id + '-' + s + '-' + face.key + '.' + rev + '.woff2';
      const buf = fs.readFileSync(face.files[s]);
      if (buf.slice(0, 4).toString('latin1') !== 'wOF2') throw new Error('not woff2: ' + face.files[s]);
      fs.writeFileSync(path.join(dir, name), buf);
      sizes[face.key + ':' + s] = buf.length;
      bytes += buf.length;
    });
  });
  const notice = 'Font: ' + meta.family + '\nCopyright: ' + lic.copyright + '\nLicence: ' + lic.license + '\nSource: npm ' + entry.pkg + '@' + entry.version +
    ' (Fontsource, from ' + (meta.source || 'Google Fonts') + ', ' + (meta.version || '') + ')\n' +
    'The font files in this folder are unmodified copies from that package (woff2, split by script subset).\n\n' + lic.text;
  fs.writeFileSync(path.join(dir, 'LICENSE.txt'), notice);
  fs.rmSync(path.dirname(pkgDir), { recursive: true, force: true });
  return {
    family: f.family, slug: f.id, style: f.style, kind: f.kind, feel: f.feel,
    subsets: subsets, faces: faces.map((face) => ({ key: face.key, weight: face.weight, italic: face.italic })),
    ranges: Object.assign({}, faces[0].ranges), missing: missing, rev: rev, bytes: bytes, sizes: sizes,
    wght: entry.variable && axis ? [Number(axis.min), Number(axis.max)] : null,
    license: lic.license, copyright: lic.copyright, pkg: entry.pkg, version: entry.version, gfVersion: meta.version || '',
    lastModified: meta.lastModified || ''
  };
}

/* ---------- LocalEditor originals: files already in the repo ---------- */
function originals() {
  if (!fs.existsSync(ORIGINALS)) return [];
  return fs.readdirSync(ORIGINALS).filter((d) => fs.existsSync(path.join(ORIGINALS, d, 'meta.json'))).map(function (slug) {
    const dir = path.join(ORIGINALS, slug);
    const m = readJSON(path.join(dir, 'meta.json'), {});
    const files = fs.readdirSync(dir).filter((n) => /\.woff2$/.test(n));
    const faces = [];
    const sizes = {};
    let bytes = 0;
    files.forEach(function (n) {
      const mm = new RegExp('^' + slug + '-(wght|\\d{3})(-italic)?\\.woff2$').exec(n);
      if (!mm) return;
      const key = (mm[1] === 'wght' ? 'v' : mm[1]) + (mm[2] ? 'i' : '');
      const size = fs.statSync(path.join(dir, n)).size;
      faces.push({ key: key, weight: mm[1] === 'wght' ? (m.wght || [100, 900]).join(' ') : mm[1], italic: !!mm[2], file: n });
      sizes[key + ':all'] = size;
      bytes += size;
    });
    if (!faces.length) return null;
    faces.sort((a, b) => (a.italic - b.italic) || String(a.key).localeCompare(String(b.key)));
    return {
      family: m.family || slug, slug: slug, style: m.style || 'display', kind: m.kind || 'decorative', feel: (m.feel || []).slice(0, 3),
      subsets: ['all'], faces: faces, ranges: {}, missing: {}, rev: '', bytes: bytes, sizes: sizes, wght: m.wght || null,
      license: m.license || 'OFL-1.1', copyright: m.copyright || '', pkg: 'localeditor', version: m.version || '1.0', source: 'localeditor',
      scripts: m.scripts || ['latin'], dir: 'assets/fonts/originals/' + slug + '/'
    };
  }).filter(Boolean);
}

/* ---------- Manifest ---------- */
function weightsOf(fam) {
  if (fam.wght) { const out = []; for (let w = Math.ceil(fam.wght[0] / 100) * 100; w <= fam.wght[1]; w += 100) out.push(w); return out; }
  const ws = fam.faces.filter((x) => !x.italic).map((x) => Number(x.weight));
  return ws.filter((w, i) => ws.indexOf(w) === i).sort((a, b) => a - b);
}
const CJK_SCRIPTS = { 'noto-sans-jp': 'japanese', 'noto-sans-kr': 'korean', 'noto-sans-sc': 'chinese-simplified', 'noto-sans-tc': 'chinese-traditional' };
function scriptsOf(fam) {
  if (fam.scripts) return fam.scripts;
  if (fam.cjk) return [CJK_SCRIPTS[fam.slug] || 'japanese', 'latin'];
  const out = [];
  fam.subsets.forEach((s) => { const sc = SCRIPT_OF[s] || s; if (out.indexOf(sc) < 0) out.push(sc); });
  /* Latin first, then the others in a stable order; a family made for one script (Noto Sans Devanagari, Kanit,
     the rows in the script sections of families.js and rows flagged 's') lists that script first. */
  const ORDER = ['latin', 'vietnamese', 'cyrillic', 'greek'];
  out.sort((a, b) => (ORDER.indexOf(a) < 0 ? 9 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 9 : ORDER.indexOf(b)));
  if (fam.scriptFirst) {
    const own = out.filter((s) => ORDER.indexOf(s) < 0);
    if (own.length) return own.concat(out.filter((s) => own.indexOf(s) < 0));
  }
  return out;
}

const PAIRS = require('./fonts/pairings.js');

function writeManifest(all, pop) {
  /* Canonical unicode ranges per subset; a family stores its own only when it differs. */
  const ranges = {};
  all.forEach((fam) => { if (!fam.cjk) Object.keys(fam.ranges || {}).forEach((s) => { if (!ranges[s] && fam.ranges[s]) ranges[s] = fam.ranges[s]; }); });
  const cjkData = {};
  /* Popularity = npm monthly downloads. Code fonts are downloaded mostly by developers' sites, not by people making
     designs, so they count a fifth. */
  const score = (fam) => (pop[fam.slug] || 0) * (fam.style === 'mono' ? 0.2 : 1);
  const rankList = all.slice().sort((a, b) => score(b) - score(a));
  const rank = {};
  rankList.forEach((fam, i) => { rank[fam.slug] = i + 1; });
  const ordered = all.slice().sort((a, b) => (a.source === 'localeditor') - (b.source === 'localeditor') || rank[a.slug] - rank[b.slug]);
  const previews = readJSON(path.join(PREVIEWS, 'previews.json'), {});
  const index = {
    v: 2,
    generated: new Date().toISOString().slice(0, 10),
    base: 'assets/fonts/library/',
    ranges: ranges,
    previews: previews.packs || [],
    families: ordered.map(function (fam) {
      const o = {
        family: fam.family, slug: fam.slug, style: fam.style, kind: fam.kind, feel: fam.feel,
        scripts: scriptsOf(fam), subsets: fam.subsets, faces: fam.faces.map((x) => x.key), weights: weightsOf(fam),
        italic: fam.faces.some((x) => x.italic), rank: rank[fam.slug], bytes: fam.bytes, rev: fam.rev, license: fam.license
      };
      if (fam.wght) o.wght = fam.wght;
      const own = {};
      Object.keys(fam.ranges || {}).forEach((s) => { if (fam.ranges[s] !== ranges[s]) own[s] = fam.ranges[s]; });
      if (fam.cjk) {
        /* Hundreds of slices: their ranges live in fonts-cjk.json, loaded only when a CJK family is used. */
        cjkData[fam.slug] = { subsets: fam.subsets, ranges: fam.ranges };
        o.subsets = [];
      } else if (Object.keys(own).length) o.ranges = own;
      if (Object.keys(fam.missing || {}).length) o.missing = fam.missing;
      if (fam.cjk) { o.cjk = true; o.base = 'assets/fonts/cjk/'; }
      if (fam.source === 'localeditor') { o.source = 'localeditor'; o.dir = fam.dir; o.files = {}; fam.faces.forEach((x) => { o.files[x.key] = x.file; }); }
      if (previews.map && previews.map[fam.slug]) o.preview = previews.map[fam.slug];
      if (fam.legacyWoff) o.woff = fam.legacyWoff;
      return o;
    }),
    pairs: PAIRS
  };
  writeJSON(path.join(DATA, 'fonts-index.json'), index);
  if (Object.keys(cjkData).length) writeJSON(path.join(DATA, 'fonts-cjk.json'), cjkData);
  /* Details: loaded only for the info view, licences and sizes per file. */
  const details = {};
  ordered.forEach(function (fam) {
    details[fam.slug] = { copyright: fam.copyright, license: fam.license, pkg: fam.pkg, version: fam.version, gf: fam.gfVersion || '', sizes: fam.sizes };
  });
  writeJSON(path.join(DATA, 'fonts-details.json'), details);
  /* le-fonts.js carries only names, style, weights and italics so list()/css() answer at once (about 6 KB). */
  const names = ordered.map((fam) => [fam.family, fam.style, fam.wght ? fam.wght.join('-') : weightsOf(fam).join(','), fam.faces.some((x) => x.italic) ? 'i' : '', fam.cjk ? 'c' : ''].join('|').replace(/\|+$/, '')).join(';');
  if (fs.existsSync(JS)) {
    const src = fs.readFileSync(JS, 'utf8');
    const a = src.indexOf('/*NAMES*/');
    const b = src.indexOf('/*NAMES_END*/');
    if (a >= 0 && b > a) fs.writeFileSync(JS, src.slice(0, a + 9) + JSON.stringify(names) + src.slice(b));
  }
  writeLicenceTable(ordered);
  return index;
}

function writeLicenceTable(list) {
  const rows = list.map((f) => '| ' + f.family + ' | ' + f.license + ' | ' + (f.pkg === 'localeditor' ? 'LocalEditor original' : '`' + f.pkg + '@' + f.version + '`') + ' | ' + (f.gfVersion || '') + ' | ' + String(f.copyright || '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 300) + ' |');
  const md = '# Font library licences\n\nGenerated by `scripts/fetch-fonts.js`. ' + list.length + ' families. Each family folder (`assets/fonts/library/<slug>/`, `assets/fonts/cjk/<slug>/`, `assets/fonts/originals/<slug>/`) carries `LICENSE.txt` with the copyright notice and the full licence text. Font files are unmodified copies from the listed npm package (Fontsource, built from github.com/google/fonts). The preview files in `assets/fonts/previews/` are subsets of the same fonts, used only under internal names (never under a Reserved Font Name).\n\n| Family | Licence | Package | Google Fonts version | Copyright |\n|---|---|---|---|---|\n' + rows.join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'assets', 'vendor', 'licenses', 'fonts-LICENSES.md'), md);
}

/* ---------- Popularity ---------- */
async function popularity() {
  const out = {};
  for (let from = 0; from < 4000; from += 250) {
    const j = await getJSON(REGISTRY + '-/v1/search?text=keywords:fontsource&size=250&from=' + from);
    if (!j || !j.objects.length) break;
    j.objects.forEach(function (o) {
      const m = /^@fontsource(-variable)?\/(.+)$/.exec(o.package.name);
      if (m) out[m[2]] = (out[m[2]] || 0) + ((o.downloads && o.downloads.monthly) || 0);
    });
    await sleep(1200);
  }
  const keep = {};
  families().forEach((f) => { keep[f.id] = out[f.id] || 0; });
  writeJSON(POP, { source: 'npm registry search, monthly downloads of @fontsource and @fontsource-variable packages', date: new Date().toISOString().slice(0, 10), downloads: keep }, true);
  console.log('popularity for ' + Object.keys(keep).length + ' families');
}

/* ---------- Main ---------- */
async function main() {
  if (flag('popularity')) return popularity();
  const fams = families();
  let lock = readJSON(LOCK, {});
  const need = fams.filter((f) => !lock[f.id] || flag('lock'));
  if (need.length) {
    console.log('resolving ' + need.length + ' packages');
    await pool(need, 6, async function (f) {
      const r = await resolve(f);
      if (!r) throw new Error('no npm package for ' + f.family);
      lock[f.id] = r;
    });
    const sorted = {};
    Object.keys(lock).sort().forEach((k) => { sorted[k] = lock[k]; });
    lock = sorted;
    writeJSON(LOCK, lock, true);
  }
  const pop = (readJSON(POP, {}).downloads) || {};
  const state = readJSON(path.join(HERE, 'built.json'), {});
  const cjk = flag('cjk');
  const todo = flag('index') || flag('previews') ? [] : fams.filter((f) => (cjk ? f.cjk : !f.cjk) && (!ONLY || ONLY.indexOf(f.family.toLowerCase()) >= 0 || ONLY.indexOf(f.id) >= 0));
  fs.mkdirSync(TMP, { recursive: true });
  const failed = [];
  let lockChanged = false;
  await pool(todo, 4, async function (f) {
    try {
      let built;
      try { built = await buildFamily(f, lock[f.id], f.cjk ? CJK_DIR : LIB, f.cjk ? null : SUBSETS); } catch (e1) {
        if (!e1.noWeightAxis) throw e1;
        /* A variable font with other axes only (League Gothic: width): use the static package instead. */
        lock[f.id] = await resolveStatic(f);
        lockChanged = true;
        built = await buildFamily(f, lock[f.id], f.cjk ? CJK_DIR : LIB, f.cjk ? null : SUBSETS);
      }
      if (f.cjk) built.cjk = true;
      built.scriptFirst = f.scriptFirst;
      state[f.id] = built;
      console.log(f.family.padEnd(26) + (lock[f.id].variable ? 'var ' : 'static ') + built.faces.map((x) => x.key).join(',').padEnd(14) + built.subsets.length + ' subsets ' + (built.bytes / 1024).toFixed(0) + ' KB');
    } catch (err) {
      failed.push(f.family + ': ' + err.message);
      console.error('FAIL ' + f.family + ': ' + err.message);
    }
  });
  fs.rmSync(TMP, { recursive: true, force: true });
  if (lockChanged) writeJSON(LOCK, lock, true);
  if (cjk) {
    /* The runtime checks this file to tell whether this copy has the CJK families. */
    const have = fams.filter((f) => f.cjk && fs.existsSync(path.join(CJK_DIR, f.id, 'LICENSE.txt'))).map((f) => f.id);
    writeJSON(path.join(CJK_DIR, 'available.json'), { families: have, generated: new Date().toISOString().slice(0, 10) });
  }
  if (flag('previews')) {
    const py = process.env.LE_PYTHON || 'python3';
    cp.execFileSync(py, [path.join(HERE, 'previews.py'), ROOT, path.join(HERE, 'built.json')], { stdio: 'inherit' });
  }
  /* Legacy WOFF files for the original 44 families (kept until the woff2 PDF path has replaced them). */
  Object.keys(state).forEach(function (id) {
    const dir = path.join(LIB, id);
    if (!fs.existsSync(dir)) return;
    const woff = fs.readdirSync(dir).filter((n) => /\.woff$/.test(n));
    if (woff.length) { const o = {}; woff.forEach((n) => { const m = /-(\d{3})(-italic)?\.woff$/.exec(n); if (m) o[m[1] + (m[2] ? 'i' : '')] = n; }); state[id].legacyWoff = o; } else delete state[id].legacyWoff;
  });
  const known = {};
  fams.forEach((f) => { known[f.id] = 1; });
  Object.keys(state).forEach((id) => { if (!known[id]) delete state[id]; });
  writeJSON(path.join(HERE, 'built.json'), state, true);
  fams.forEach((f) => { if (state[f.id]) { state[f.id].scriptFirst = f.scriptFirst; state[f.id].feel = f.feel; state[f.id].style = f.style; state[f.id].kind = f.kind; } });
  const all = fams.map((f) => state[f.id]).filter(Boolean).concat(originals());
  const index = writeManifest(all, pop);
  const lib = all.filter((f) => !f.cjk && f.source !== 'localeditor');
  console.log('families ' + index.families.length + ' (' + lib.length + ' in git, ' + all.filter((f) => f.cjk).length + ' CJK) library ' + (lib.reduce((a, f) => a + f.bytes, 0) / 1048576).toFixed(2) + ' MB');
  if (failed.length) { console.error(failed.join('\n')); process.exitCode = 1; }
}

main().catch(function (err) { console.error(err); process.exit(1); });
