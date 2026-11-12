#!/usr/bin/env node
/* Generates /licenses/index.html ("Open-source licences") from assets/vendor/LICENSES.md.
 *   node tools/licenses-page/build.js
 * The camera RAW decoder gets its own clearly marked section (id "libraw") with the written source offer, written here by hand because its wording matters.
 * Everything else is the markdown file's headings, paragraphs and tables, so the page cannot drift from the list the repository keeps.
 */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const md = fs.readFileSync(path.join(root, 'assets/vendor/LICENSES.md'), 'utf8').split('\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(https?:\/\/[^\s<)·|]+)/g, (u) => { const t = u.replace(/[.,;]+$/, ''); return '<a href="' + t + '" rel="noopener">' + t + '</a>' + u.slice(t.length); });
  return s;
}
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let html = '', i = 0, inRaw = false, open = false;
while (i < md.length) {
  const line = md[i];
  if (/^## /.test(line) || /^### /.test(line)) {
    const lvl = line.startsWith('### ') ? 3 : 2, text = line.replace(/^#+ /, '');
    const isRaw = /Camera RAW support/.test(text);
    if (lvl === 2 && open) { html += '</section>\n'; open = false; inRaw = false; }
    if (lvl === 2) open = true;
    if (lvl === 2) html += '<section class="card' + (isRaw ? ' raw-exception' : '') + '" id="' + (isRaw ? 'libraw' : slug(text)) + '">\n';
    html += '<h' + lvl + '>' + inline(text) + '</h' + lvl + '>\n';
    if (isRaw) {
      inRaw = true;
      html += '<p class="exception"><b>Owner-approved exception.</b> This one optional component is licensed under the GNU Lesser General Public License, version 2.1, which is outside the permissive-only rule the rest of the site follows. It is a separate download that is fetched only when you open a camera RAW file, runs in its own Web Worker, and can be removed from the storage manager at any time.</p>\n';
      html += '<h3 id="libraw-source">Where to get the licence and the source</h3><ul>' +
        '<li>Licence text: <a href="../assets/vendor/licenses/libraw-LICENSE.LGPL.txt">GNU LGPL 2.1</a> (LibRaw is also offered under the <a href="../assets/vendor/licenses/libraw-LICENSE.CDDL.txt">CDDL 1.0</a>; LocalEditor uses it under the LGPL), and LibRaw\'s <a href="../assets/vendor/licenses/libraw-COPYRIGHT.txt">copyright notices</a>.</li>' +
        '<li>Source of the module: LibRaw 0.22.2, unmodified, <a href="https://github.com/LibRaw/LibRaw/tree/0.22.2" rel="noopener">https://github.com/LibRaw/LibRaw/tree/0.22.2</a>, plus LocalEditor\'s glue and build recipe in <code>tools/raw-decoder/</code> of the LocalEditor source. Every source file and its SHA-256 is listed in <code>tools/raw-decoder/sources.json</code>.</li>' +
        '<li><b>Written offer.</b> The complete corresponding source of the Camera RAW support module is available to anyone who has received it, for at least three years from the day that version was last served. Ask at <b>[contact address, to be set by the owner]</b>.</li>' +
        '<li><b>Replacing it.</b> The editor talks to the module only through a small message interface, so you (or a host that embeds LocalEditor) can swap in your own build of LibRaw or another decoder. See <code>assets/vendor/raw-decoder/README.md</code>.</li></ul>\n';
    }
    i++; continue;
  }
  if (/^\|/.test(line)) {
    const rows = []; while (i < md.length && /^\|/.test(md[i])) { rows.push(md[i]); i++; }
    const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]), body = rows.slice(2).map(cells);
    html += '<div class="tbl"><table><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
      body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>\n';
    continue;
  }
  if (/^# /.test(line) || !line.trim()) { i++; continue; }
  let para = line; i++; while (i < md.length && md[i].trim() && !/^(#|\|)/.test(md[i])) { para += ' ' + md[i]; i++; }
  html += '<p>' + inline(para) + '</p>\n';
}
if (open) html += '</section>\n';

const page = `<!doctype html>
<html lang="en" data-root="../">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Open-source licences — LocalEditor</title>
<meta name="description" content="Every third-party component LocalEditor includes, with its licence, and the source offer for the optional Camera RAW support module.">
<link rel="canonical" href="https://localeditor.net/licenses/">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#141318">
<link rel="manifest" href="../manifest.webmanifest">
<link rel="icon" href="../assets/icons/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../assets/css/app.css">
<script>try{var t=localStorage.getItem('le-theme')||localStorage.getItem('it-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
<style>
  .tbl{overflow-x:auto;margin:.6em 0 1em}
  .tbl table{border-collapse:collapse;font-size:.88rem;min-width:640px}
  .tbl th,.tbl td{border:1px solid var(--line,#ddd);padding:.4em .6em;text-align:left;vertical-align:top}
  .tbl th{background:var(--surface,transparent);font-weight:600}
  .tbl code{word-break:break-all}
  .raw-exception{border-left:4px solid var(--gold,#e8b84a)}
  .exception{margin-top:0}
  section.card{margin-bottom:1.2em}
  td a{word-break:break-all}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<main id="main" class="container" style="max-width:1060px">
  <section class="hero"><span class="eyebrow">About</span><h1>Open-source licences</h1>
  <p class="lead">LocalEditor is built from open-source parts that are copied into the site, so it works offline and nothing is loaded from other servers. Here is every one of them, with its licence. This page is generated from <code>assets/vendor/LICENSES.md</code>.</p>
  <p><a href="#libraw">Camera RAW support (LibRaw, LGPL 2.1): licence and source offer</a></p></section>
${html}
</main>
<footer class="site-footer"><div class="container">
  <span>© 2026 LocalEditor · Files stay on this device.</span>
  <span><a href="../">All tools</a> · <a href="../about/">About &amp; privacy</a> · <a href="../llms.txt">llms.txt</a></span>
</div></footer>
<script src="../assets/js/app.js"></script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'licenses'), { recursive: true });
fs.writeFileSync(path.join(root, 'licenses/index.html'), page);
console.log('licenses/index.html', page.length, 'bytes');
