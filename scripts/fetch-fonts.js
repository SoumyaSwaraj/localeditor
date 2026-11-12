#!/usr/bin/env node
/* Downloads the LocalEditor offline font library.
   woff2 subsets (latin, latin-ext) for the browser, one WOFF per face for pdf-lib.
   Run from anywhere: node scripts/fetch-fonts.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'fonts', 'library');
const MANIFEST_PATH = path.join(ROOT, 'assets', 'data', 'fonts.json');
const JS_PATH = path.join(ROOT, 'assets', 'js', 'le-fonts.js');
const UA_WOFF2 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA_WOFF = 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0';

const FAMILIES = [
  ['Inter', 'sans', true],
  ['Poppins', 'sans', false],
  ['Montserrat', 'sans', false],
  ['DM Sans', 'sans', false],
  ['Manrope', 'sans', false],
  ['Space Grotesk', 'sans', false],
  ['Outfit', 'sans', false],
  ['Nunito', 'sans', true],
  ['Work Sans', 'sans', false],
  ['Rubik', 'sans', false],
  ['Plus Jakarta Sans', 'sans', false],
  ['Playfair Display', 'serif', true],
  ['Lora', 'serif', true],
  ['Merriweather', 'serif', true],
  ['DM Serif Display', 'serif', true],
  ['Cormorant Garamond', 'serif', true],
  ['Libre Baskerville', 'serif', true],
  ['Fraunces', 'serif', true],
  ['EB Garamond', 'serif', true],
  ['Instrument Serif', 'serif', true],
  ['Bebas Neue', 'display', false],
  ['Anton', 'display', false],
  ['Archivo Black', 'display', false],
  ['Abril Fatface', 'display', false],
  ['Righteous', 'display', false],
  ['Lobster', 'display', false],
  ['Bungee', 'display', false],
  ['Oswald', 'display', false],
  ['Syne', 'display', false],
  ['Dancing Script', 'handwriting', false],
  ['Great Vibes', 'handwriting', false],
  ['Caveat', 'handwriting', false],
  ['Sacramento', 'handwriting', false],
  ['Pacifico', 'handwriting', false],
  ['Satisfy', 'handwriting', false],
  ['Allura', 'handwriting', false],
  ['Kalam', 'handwriting', false],
  ['Shadows Into Light', 'handwriting', false],
  ['Homemade Apple', 'handwriting', false],
  ['Mr Dafoe', 'handwriting', false],
  ['Alex Brush', 'handwriting', false],
  ['JetBrains Mono', 'mono', false],
  ['Space Mono', 'mono', false],
  ['IBM Plex Mono', 'mono', false]
];

const WEIGHTS = [400, 700];
let active = 0;
const waiters = [];

function gate(fn) {
  return new Promise(function (resolve, reject) {
    const run = function () {
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(function () {
          active--;
          const next = waiters.shift();
          if (next) next();
        });
    };
    if (active < 8) run();
    else waiters.push(run);
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function getText(url, ua) {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await gate(function () {
      return fetch(url, { headers: { 'User-Agent': ua } });
    });
    last = await res.text();
    if (res.status === 429 || res.status >= 500) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    return { ok: res.ok, status: res.status, text: last };
  }
  return { ok: false, status: 429, text: last };
}

async function getBuf(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await gate(function () { return fetch(url); });
    if (res.status === 429 || res.status >= 500) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(res.status + ' ' + url);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('give up ' + url);
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseCss(css) {
  const faces = [];
  const parts = css.split('/*');
  const chunks = parts.length > 1 ? parts.slice(1) : [css];
  chunks.forEach(function (part) {
    let subset = '';
    let body = part;
    const end = part.indexOf('*/');
    if (parts.length > 1 && end >= 0) {
      subset = part.slice(0, end).trim().toLowerCase();
      body = part.slice(end + 2);
    }
    if (!body.includes('@font-face') && !body.includes('font-family')) return;
    const family = /font-family:\s*'([^']+)'/.exec(body);
    const style = /font-style:\s*(\w+)/.exec(body);
    const weight = /font-weight:\s*(\d+)/.exec(body);
    const url = /url\(([^)]+)\)/.exec(body);
    const range = /unicode-range:\s*([^;]+)/.exec(body);
    const format = /format\('([^']+)'\)/.exec(body);
    if (!url) return;
    faces.push({
      subset: subset,
      family: family ? family[1] : '',
      style: style ? style[1] : 'normal',
      weight: weight ? Number(weight[1]) : 400,
      url: url[1].replace(/['"]/g, ''),
      unicodeRange: range ? range[1].trim() : '',
      format: format ? format[1] : ''
    });
  });
  return faces;
}

function magic(buf, kind) {
  const sig = buf.slice(0, 4).toString('latin1');
  if (kind === 'woff2') return sig === 'wOF2';
  if (kind === 'woff') return sig === 'wOFF';
  return false;
}

async function cssFor(family, weight, italic, ua) {
  const name = family.replace(/ /g, '+');
  const urls = [];
  if (italic) urls.push('https://fonts.googleapis.com/css2?family=' + name + ':ital,wght@1,' + weight + '&display=swap');
  else {
    urls.push('https://fonts.googleapis.com/css2?family=' + name + ':ital,wght@0,' + weight + '&display=swap');
    urls.push('https://fonts.googleapis.com/css2?family=' + name + ':wght@' + weight + '&display=swap');
    if (weight === 400) urls.push('https://fonts.googleapis.com/css2?family=' + name + '&display=swap');
  }
  for (const url of urls) {
    const res = await getText(url, ua);
    if (!res.ok || !res.text.includes('font-family') || /font family not found|missing font|error/i.test(res.text.slice(0, 180))) continue;
    const faces = parseCss(res.text).filter(function (face) {
      return face.weight === weight && (italic ? face.style === 'italic' : face.style !== 'italic');
    });
    if (faces.length) return faces;
  }
  return [];
}

function rel() {
  return path.posix.join('assets/fonts/library');
}

async function writeFont(url, dest, kind) {
  const buf = await getBuf(url);
  if (!magic(buf, kind)) throw new Error('bad ' + kind + ' magic for ' + url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function fetchFamily(entry) {
  const family = entry[0];
  const category = entry[1];
  const wantItalic = entry[2];
  const slug = slugify(family);
  const dir = path.join(OUT, slug);
  const license = family === 'Homemade Apple' ? 'Apache-2.0' : 'OFL-1.1';
  const files = {};
  const weights = [];
  const italicWeights = [];
  let version = '';
  let bytes = 0;

  async function one(weight, italic) {
    const subsets = await cssFor(family, weight, italic, UA_WOFF2);
    const wanted = subsets.filter(function (face) { return face.subset === 'latin' || face.subset === 'latin-ext'; });
    const embedFaces = await cssFor(family, weight, italic, UA_WOFF);
    const embed = embedFaces.find(function (face) { return face.format === 'woff' || /\.woff($|\?)/.test(face.url); }) || embedFaces[0];
    if (!wanted.length && !embed) return;
    const key = String(weight) + (italic ? 'i' : '');
    const slot = { woff2: {}, unicodeRange: {} };
    for (const face of wanted) {
      const file = slug + '-' + weight + (italic ? '-italic' : '') + '-' + face.subset + '.woff2';
      const size = await writeFont(face.url, path.join(dir, file), 'woff2');
      bytes += size;
      slot.woff2[face.subset] = 'assets/fonts/library/' + slug + '/' + file;
      if (face.unicodeRange) slot.unicodeRange[face.subset] = face.unicodeRange;
      const ver = /\/v(\d+)\//.exec(face.url);
      if (ver) version = ver[1];
    }
    if (embed) {
      const file = slug + '-' + weight + (italic ? '-italic' : '') + '.woff';
      const size = await writeFont(embed.url, path.join(dir, file), 'woff');
      bytes += size;
      slot.woff = 'assets/fonts/library/' + slug + '/' + file;
      const ver = /\/v(\d+)\//.exec(embed.url);
      if (ver) version = ver[1];
    }
    if (!slot.woff && !Object.keys(slot.woff2).length) return;
    files[key] = slot;
    if (italic) italicWeights.push(weight);
    else if (weights.indexOf(weight) < 0) weights.push(weight);
  }

  for (const weight of WEIGHTS) await one(weight, false);
  if (wantItalic) await one(400, true);
  weights.sort(function (a, b) { return a - b; });
  if (!weights.length) throw new Error('no files for ' + family);
  console.log(family + ' ' + category + ' w[' + weights.join(',') + '] i[' + italicWeights.join(',') + '] ' + (bytes / 1024).toFixed(0) + 'KB v' + version);
  return {
    family: family,
    slug: slug,
    category: category,
    weights: weights,
    italic: italicWeights.length > 0,
    italicWeights: italicWeights,
    license: license,
    version: version,
    files: files,
    bytes: bytes
  };
}

function inject(file, startMark, endMark, content) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a + startMark.length);
  if (a < 0 || b < 0) throw new Error('marker missing in ' + file);
  fs.writeFileSync(file, src.slice(0, a + startMark.length) + content + src.slice(b));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  const families = [];
  for (const entry of FAMILIES) {
    try {
      families.push(await fetchFamily(entry));
    } catch (err) {
      console.error('FAIL', entry[0], err.message);
      process.exitCode = 1;
    }
  }
  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'https://fonts.google.com',
    families: families.map(function (f) {
      return {
        family: f.family,
        slug: f.slug,
        category: f.category,
        weights: f.weights,
        italic: f.italic,
        italicWeights: f.italicWeights,
        license: f.license,
        version: f.version,
        files: f.files
      };
    })
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
  if (fs.existsSync(JS_PATH)) {
    inject(JS_PATH, '/*MANIFEST*/', '/*MANIFEST_END*/', JSON.stringify(manifest.families));
  }
  const total = families.reduce(function (sum, f) { return sum + f.bytes; }, 0);
  const files = families.reduce(function (sum, f) { return sum + Object.keys(f.files).length; }, 0);
  console.log('families ' + families.length + ' faces ' + files + ' total ' + (total / 1048576).toFixed(2) + 'MB');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
