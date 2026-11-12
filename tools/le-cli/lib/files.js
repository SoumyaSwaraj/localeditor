'use strict';
/* Files on disk: the sandbox (which paths may be read or written), image references next to a design, atomic writes
   and revisions. Nothing outside the allowed folders is ever read: path traversal (..) and symlinks that lead out are
   refused after resolving real paths. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LEError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

const MAX_JSON = 12 * 1024 * 1024;
const MAX_IMAGE = 80 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 200 * 1024 * 1024;

function realOrParent(p) {
  /* The real path of p, or of its closest existing ancestor joined with the rest (for files about to be created). */
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch (e) {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class Sandbox {
  /* root: null (anything the caller names) or a folder everything must stay in. allow: extra folders for images. */
  constructor(opts) {
    opts = opts || {};
    this.root = opts.root ? realOrParent(opts.root) : null;
    this.allow = (opts.allow || []).map((p) => realOrParent(p));
  }
  /* A design (or output) path given by the caller. */
  file(p, what) {
    if (typeof p !== 'string' || !p.trim()) throw new LEError('invalid', 'Give a file path' + (what ? ' for ' + what : '') + '.');
    if (p.indexOf('\0') >= 0) throw new LEError('invalid', 'That path is not valid.');
    const abs = path.resolve(this.root || process.cwd(), p);
    if (this.root) {
      if (!inside(abs, this.root) && !inside(realOrParent(abs), this.root) && !this.allow.some((a) => inside(abs, a))) throw new LEError('sandbox', 'The path ' + p + ' is outside the allowed folder (' + this.root + ').');
      const real = realOrParent(abs);
      if (!inside(real, this.root) && !this.allow.some((a) => inside(real, a))) throw new LEError('sandbox', 'The path ' + p + ' leads outside the allowed folder through a symbolic link.');
    }
    return abs;
  }
  /* An image reference from inside a design: relative to the design's folder, never out of it (or out of --allow-path). */
  image(designFile, rel) {
    if (typeof rel !== 'string' || !rel || rel.length > 400) return { error: 'empty path' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/') || rel.indexOf('\\') >= 0 || /[?#\0]/.test(rel) || rel.split('/').some((s) => s === '..')) return { error: 'Image paths are relative to the design, without "..", "\\", "?", "#" or a leading "/".' };
    const dir = path.dirname(path.resolve(designFile));
    const abs = path.resolve(dir, rel);
    const realDir = realOrParent(dir);
    let real;
    try { real = fs.realpathSync.native(abs); } catch (e) { return { error: 'not found', missing: true }; }
    const okDir = inside(real, realDir) && (!this.root || inside(real, this.root));
    const okAllow = this.allow.some((a) => inside(real, a));
    if (!okDir && !okAllow) return { error: 'The image ' + rel + ' leads outside the design folder; it was not read. (Use --allow-path to permit a folder.)', refused: true };
    return { abs: real };
  }
}

/* Every image reference in an open-format document (object). */
function imageRefs(doc) {
  const out = [];
  const pages = (doc && Array.isArray(doc.pages)) ? doc.pages : [];
  pages.forEach((p, pi) => {
    if (!p || typeof p !== 'object') return;
    if (p.background && typeof p.background === 'object' && typeof p.background.src === 'string') out.push({ path: '/pages/' + pi + '/background/src', src: p.background.src });
    (Array.isArray(p.layers) ? p.layers : []).forEach((l, li) => {
      if (!l || typeof l !== 'object') return;
      if (typeof l.src === 'string') out.push({ path: '/pages/' + pi + '/layers/' + li + '/src', src: l.src, layer: l.id });
      if (l.fx && typeof l.fx === 'object' && typeof l.fx.src === 'string') out.push({ path: '/pages/' + pi + '/layers/' + li + '/fx/src', src: l.fx.src, layer: l.id });
    });
  });
  return out;
}
function opsImageRefs(ops) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (k === 'src' && typeof v[k] === 'string') out.push({ src: v[k] }); else walk(v[k]); }
  };
  walk(ops);
  return out;
}
const isRelative = (s) => typeof s === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[0-9a-f]{64}$/.test(s);

/* Reads the relative images a document (or a batch of operations) refers to → { files: { rel: base64 }, notes: [] } */
function collectImages(sandbox, designFile, refs) {
  const files = {};
  const notes = [];
  let total = 0;
  for (const r of refs) {
    if (!isRelative(r.src) || files[r.src]) continue;
    const got = sandbox.image(designFile, r.src);
    if (got.error) { notes.push({ path: r.path || '', layer: r.layer || null, kind: got.refused ? 'refused-path' : 'missing-image', message: got.missing ? 'The image ' + r.src + ' was not found next to the design.' : got.error }); continue; }
    let st;
    try { st = fs.statSync(got.abs); } catch (e) { continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_IMAGE) { notes.push({ path: r.path || '', kind: 'too-large', message: 'The image ' + r.src + ' is larger than 80 MB.' }); continue; }
    total += st.size;
    if (total > MAX_IMAGES_TOTAL) throw new LEError('too-large', 'The images of this design add up to more than 200 MB.');
    files[r.src] = fs.readFileSync(got.abs).toString('base64');
  }
  return { files, notes };
}

function readDesign(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { throw new LEError('not-found', 'There is no file at ' + file + '.'); }
  if (!st.isFile()) throw new LEError('invalid', file + ' is not a file.');
  if (st.size > MAX_JSON) throw new LEError('too-large', 'This design file is larger than 12 MB. Use relative image paths instead of embedded images.');
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

const rev = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/* Atomic write: a temporary file in the same folder, then rename over the target. */
function writeAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + crypto.randomBytes(5).toString('hex') + '.tmp');
  let mode;
  try { mode = fs.statSync(file).mode & 0o777; } catch (e) { mode = 0o644; }
  fs.writeFileSync(tmp, data, { mode });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) {} throw e; }
}

/* poster.ledesign.json → poster.le (the feedback folder next to the design). */
function statusDir(file) {
  const base = path.basename(file).replace(/\.ledesign\.json$/i, '').replace(/\.json$/i, '');
  return path.join(path.dirname(file), base + '.le');
}

module.exports = { LEError, Sandbox, imageRefs, opsImageRefs, collectImages, readDesign, rev, writeAtomic, statusDir, isRelative, inside, realOrParent, MAX_JSON };
