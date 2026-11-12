#!/usr/bin/env node
/* Category hubs and feature pages, generated from assets/data/site.json. See docs/SITE.md.
   Run from the repo root:  node scripts/build-pages.js   (node scripts/build.js runs it too)
   Writes:
     <url>/index.html        one page per live or beta category, audience hub or feature
     assets/js/app.js        the site index block (header search and the drawer's hub list)
     index.html              the "Browse by what you need" list and the footer hub links
     llms.txt                the "Find by need" section
   Entries with status "soon" are data only: no page, no link, no mention anywhere.
   The output depends only on the data, so running it twice changes nothing. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://localeditor.net/';
const DATA = path.join(ROOT, 'assets/data/site.json');
const MARK = '<meta name="generator" content="scripts/build-pages.js">';
const VISIBLE = ['live', 'beta'];
const PAGE_KINDS = ['category', 'audience', 'feature'];

/* ---------- Icons (24px stroke). Tools from build.js bring their own. ---------- */
const ICONS = {
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.4"/><path d="m21 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L7 18"/>',
  pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  pdfstudio: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="m9.5 17 4.8-4.8a1.3 1.3 0 0 1 1.8 1.8L11.3 18.8 9 19.3z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  sizes: '<rect x="3" y="7" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="18" rx="1.5"/>',
  shop: '<path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/>',
  school: '<path d="M2 9.5 12 5l10 4.5-10 4.5z"/><path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5M22 9.5V15"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  collage: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
  background: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 15.5l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8" r="1.5"/>',
  recipes: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 12h6M9 16h4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  brand: '<path d="M12 3.5l2.3 4.7 5.2.8-3.8 3.6.9 5.2L12 15.4l-4.6 2.4.9-5.2-3.8-3.6 5.2-.8z"/><path d="M5 21h14"/>',
  convert: '<path d="M4 7h11l-3-3M20 17H9l3 3"/><path d="M17 4h3v6M7 20H4v-6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  storage: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  redact: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h6M7 14h10"/>',
  cutout: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c.8-4 3.6-6 7-6s6.2 2 7 6"/><path d="M3 3h3M18 3h3M3 3v3M21 3v3" />',
  thumbnail: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  carousel: '<rect x="6" y="5" width="12" height="14" rx="2"/><path d="M3 7v10M21 7v10"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>',
  stack: '<rect x="4" y="4" width="13" height="16" rx="2"/><path d="M8 2h11a2 2 0 0 1 2 2v15"/>',
  split: '<path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8"/>',
  stamp: '<path d="M5 22h14M19.3 14.3A2 2 0 0 0 18 14H6a2 2 0 0 0-2 2v2h16v-2a2 2 0 0 0-.7-1.7zM14 14V9.5a4 4 0 1 0-4 0V14"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  filters: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M4 20.5A1.5 1.5 0 0 0 5.5 22H20"/>',
};

/* ---------- Helpers ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const headline = (s) => esc(s).replace(/\{([^}]*)\}/g, '<em>$1</em>');
const plain = (s) => String(s).replace(/[{}]/g, '');
const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';

function buildModule() { return require('./build.js'); }

function svg(name, extra) {
  const tools = buildModule().I || {};
  const p = ICONS[name] || tools[name] || ICONS.grid;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ''}>${p}</svg>`;
}

/* ---------- Data ---------- */
function load() {
  const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const b = buildModule();
  const byId = new Map();
  for (const e of raw.entries) {
    if (byId.has(e.id)) throw new Error('site.json: duplicate id ' + e.id);
    byId.set(e.id, e);
  }
  /* The single-step tools live in scripts/build.js (TOOLS); site.json refers to them as "tool:<slug>". */
  for (const t of b.TOOLS) {
    byId.set('tool:' + t.slug, { id: 'tool:' + t.slug, kind: 'tool', status: 'live', title: t.name, tagline: t.desc, launch: t.slug + '/', icon: t.icon, cat: t.cat, keywords: [t.slug.replace(/-/g, ' ')] });
  }
  const site = { raw, byId, entries: raw.entries, cats: b.CATS, tools: b.TOOLS };
  site.get = (id) => {
    const e = byId.get(id);
    if (!e) throw new Error('site.json: unknown id "' + id + '"');
    return e;
  };
  site.visible = (e) => VISIBLE.includes(e.status);
  site.hasPage = (e) => PAGE_KINDS.includes(e.kind) && !!e.url && site.visible(e);
  site.pages = raw.entries.filter(site.hasPage);
  site.hubs = site.pages.filter((e) => e.kind !== 'feature');
  site.features = site.pages.filter((e) => e.kind === 'feature');
  /* Items in listings: live or beta only, resolved, never duplicated. */
  site.items = (ids) => {
    const seen = new Set();
    return (ids || []).map(site.get).filter((e) => site.visible(e) && !seen.has(e.id) && seen.add(e.id));
  };
  validate(site);
  return site;
}

function launchExists(site, launch) {
  const p = launch.split(/[?#]/)[0];
  if (!p) return true;
  if (site.pages.some((e) => e.url === p)) return true;
  const f = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  return fs.existsSync(f);
}

function validate(site) {
  const errs = [];
  const urls = new Set();
  for (const e of site.entries) {
    if (!/^[a-z0-9-]+$/.test(e.id)) errs.push(e.id + ': ids are lowercase words joined by hyphens');
    if (!['category', 'audience', 'feature', 'tool'].includes(e.kind)) errs.push(e.id + ': unknown kind ' + e.kind);
    if (!['live', 'beta', 'soon'].includes(e.status)) errs.push(e.id + ': status must be live, beta or soon');
    if (!e.title || !e.tagline) errs.push(e.id + ': needs a title and a tagline');
    if (e.url) {
      if (!/^[a-z0-9-]+\/$/.test(e.url)) errs.push(e.id + ': url must look like "short-name/"');
      if (urls.has(e.url)) errs.push(e.id + ': url ' + e.url + ' is used twice');
      urls.add(e.url);
    }
    const refs = [].concat(e.related || [], e.parents || [], e.audiences || [], e.items || [], ...(e.sections || []).map((s) => s.items || []));
    refs.forEach((r) => { if (!site.byId.has(r)) errs.push(e.id + ': refers to unknown id ' + r); });
    if (!site.visible(e)) continue;
    if (e.kind === 'tool' && !e.launch) errs.push(e.id + ': a tool needs a launch URL');
    if (e.launch && !launchExists(site, e.launch)) errs.push(e.id + ': launch ' + e.launch + ' does not resolve to a page');
    if (!site.hasPage(e)) continue;
    const dir = path.join(ROOT, e.url);
    if (fs.existsSync(path.join(dir, 'index.html')) && !fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes(MARK)) {
      errs.push(e.id + ': ' + e.url + ' already holds a page this script did not write');
    }
    ['headline', 'metaTitle', 'description', 'summary', 'privacy'].forEach((k) => { if (!e[k]) errs.push(e.id + ': needs ' + k); });
    if (e.description && e.description.length > 170) errs.push(e.id + ': description is over 170 characters');
    if (!Array.isArray(e.faq) || e.faq.length < 2 || e.faq.length > 4) errs.push(e.id + ': needs 2 to 4 FAQ entries');
    if (e.kind === 'feature') {
      if (!e.launch || !e.launchLabel) errs.push(e.id + ': needs launch and launchLabel');
      if (!Array.isArray(e.does) || e.does.length < 3 || e.does.length > 5) errs.push(e.id + ': needs 3 to 5 "does" bullets');
      if (!Array.isArray(e.steps) || e.steps.length !== 3) errs.push(e.id + ': needs exactly 3 steps');
      if (!(e.parents || []).some((p) => site.hasPage(site.byId.get(p)))) errs.push(e.id + ': needs a live parent category');
    } else if (!e.sections && !e.directory) errs.push(e.id + ': a hub needs sections');
  }
  if (errs.length) throw new Error('site.json has problems:\n  ' + errs.join('\n  '));
}

/* ---------- Shared page parts ---------- */
function head(site, e, ldGraph) {
  const url = SITE + e.url;
  const title = plain(e.metaTitle) + ' | LocalEditor';
  return `<!doctype html>
<html lang="en" data-root="../">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(e.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
${MARK}
<meta name="theme-color" content="#F7F6F3">
<link rel="manifest" href="../manifest.webmanifest">
<link rel="icon" href="../assets/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../assets/icons/icon-192.png">
<link rel="preload" href="../assets/fonts/jakarta-latin.woff2" as="font" type="font/woff2" crossorigin>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="LocalEditor">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LocalEditor">
<meta property="og:title" content="${esc(plain(e.metaTitle))}">
<meta property="og:description" content="${esc(e.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}assets/icons/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="../assets/css/app.css">
<link rel="stylesheet" href="../assets/css/pages.css">
<script>try{var t=localStorage.getItem('le-theme')||localStorage.getItem('it-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
${ld({ '@context': 'https://schema.org', '@graph': ldGraph })}
</head>
<body class="le-built pg-body">
<a class="skip" href="#main">Skip to content</a>
<div class="le-app">
  <aside class="le-side" data-fill aria-label="Menu"></aside>
  <div class="le-main">
    <header class="le-top" data-fill></header>
    <main id="main" class="le-content">
      <div class="pg">
`;
}

function footerHTML(site, rel) {
  const hubs = site.hubs.map((h) => `<a href="${rel}${h.url}">${esc(h.title)}</a>`).join('\n              ');
  return `<footer class="hp-foot pg-foot">
          <div class="hp-foot-top">
            <a class="le-brand" href="${rel || './'}"><span class="le-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#E9BE6A"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#2A1F0A" stroke-width="1.9"/><circle cx="16" cy="16" r="2" fill="#2A1F0A"/></svg></span><span><strong>LocalEditor</strong></span></a>
            <nav aria-label="Footer">
              <a href="${rel}studio/">Photo studio</a>
              <a href="${rel}pdf-studio/">PDF studio</a>
              <a href="${rel}recipes/">Recipes</a>
              <a href="${rel}about/">Privacy</a>
              <button type="button" data-le-install>Install</button>
              <button type="button" data-le-storage>Storage</button>
              <a href="${rel}llms.txt">llms.txt</a>
            </nav>
          </div>
          <nav class="pg-foot-hubs" aria-label="Browse by need">
              ${hubs}
          </nav>
          <p>&copy; ${new Date().getFullYear()} LocalEditor. Files stay on your device.</p>
        </footer>`;
}

function tail(site) {
  return `
        ${footerHTML(site, '../')}
      </div>
    </main>
  </div>
</div>
<button class="le-scrim" type="button" data-scrim hidden tabindex="-1" aria-label="Close menu"></button>
<script src="../assets/js/app.js"></script>
</body>
</html>
`;
}

function crumbs(trail) {
  const items = trail.map((t, i) => i === trail.length - 1
    ? `<li aria-current="page">${esc(t[0])}</li>`
    : `<li><a href="${t[1]}">${esc(t[0])}</a></li>`).join('');
  return `<nav class="pg-crumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}
function crumbsLD(trail) {
  return { '@type': 'BreadcrumbList', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t[0], item: t[2] })) };
}
function faqLD(e) {
  return { '@type': 'FAQPage', mainEntity: e.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
}

/* The launch control. Install and storage open their dialogs in place; the href is the fallback. */
function launchAttrs(e) {
  return e.action === 'install' ? ' data-le-install' : e.action === 'storage' ? ' data-le-storage' : '';
}
function badge(e) { return e.status === 'beta' ? '<span class="pg-beta">Beta</span>' : ''; }

/* One row in a hub list. A feature with a page links to the page and has its own Open link. */
function row(site, e, rel) {
  if (site.hasPage(e)) {
    return `<li class="pg-row">
            <a class="pg-row-main" href="${rel}${e.url}"><span class="hp-tool-ic">${svg(e.icon)}</span><span><b>${esc(e.title)}${badge(e)}</b><small>${esc(e.tagline)}</small></span></a>
            <a class="pg-row-go" href="${rel}${e.launch}"${launchAttrs(e)} aria-label="Open ${esc(e.title)}">Open</a>
          </li>`;
  }
  return `<li class="pg-row">
            <a class="pg-row-main" href="${rel}${e.launch}"><span class="hp-tool-ic">${svg(e.icon)}</span><span><b>${esc(e.title)}${badge(e)}</b><small>${esc(e.tagline)}</small></span><span class="pg-row-arrow">${svg('arrow')}</span></a>
          </li>`;
}

function faqHTML(e, title) {
  return `<section class="hp-section hp-faq pg-faq" aria-labelledby="pg-faq-title">
          <div class="hp-head">
            <p class="eyebrow">Questions</p>
            <h2 id="pg-faq-title">${title}</h2>
            <p>More on the <a href="../about/">privacy and install page</a>.</p>
          </div>
          <div class="faq">
            ${e.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n            ')}
          </div>
        </section>`;
}

function privacyHTML(e, title) {
  return `<section class="pg-privacy" aria-labelledby="pg-privacy-title">
          <span class="pg-privacy-ic" aria-hidden="true">${svg('lock')}</span>
          <div>
            <h2 id="pg-privacy-title">${esc(title)}</h2>
            <p>${esc(e.privacy)}</p>
          </div>
        </section>`;
}

/* ---------- Art: small, honest compositions of the real UI, in HTML and CSS ---------- */
const IMG = (f, w, h, alt) => `<img src="../assets/img/home/${f}" width="${w}" height="${h}" alt="${alt || ''}" loading="lazy" decoding="async">`;
const ART = {
  collage: () => `<div class="hp-collage">${IMG('garden-05.webp', 560, 374)}${IMG('still-01.webp', 560, 374)}${IMG('travel-08.webp', 560, 374)}</div><span class="hp-collage-cap">weekend, slowly</span>`,
  doc: () => `<div class="hp-doc hp-doc-2"></div><div class="hp-doc"><b>Rental agreement</b><i></i><i class="m"></i><i></i><i class="s"></i><i class="gap"></i><i></i><i class="m"></i><div class="hp-sign"><svg viewBox="0 0 160 48" preserveAspectRatio="none"><path d="M4 34c10-2 14-24 22-24 7 0-4 30 4 30 6 0 10-20 16-20 5 0 1 14 7 14 5 0 9-10 14-10 4 0 2 8 7 8 8 0 18-8 30-10 10-2 20 0 30 2" fill="none" stroke="#4E36C9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><small>Signed here</small></div></div><span class="hp-doc-chip"><i></i>Saved on this device</span>`,
  office: () => `<div class="hp-doc hp-doc-2"></div><div class="hp-doc pg-doc-conf"><b>Offer letter</b><i></i><i class="m"></i><i></i><i class="s"></i><i class="gap"></i><i></i><i class="m"></i><i></i><i class="s"></i><span class="pg-wm">CONFIDENTIAL</span></div><span class="hp-doc-chip pg-chip-lock">${svg('lock')}Not uploaded</span>`,
  class: () => `<div class="hp-doc hp-doc-2"></div><div class="hp-doc"><b>Trip permission slip</b><i></i><i class="m"></i><i class="s"></i><span class="pg-tick"><em></em>I give permission</span><span class="pg-tick"><em class="on">${svg('check')}</em>Packed lunch needed</span><div class="hp-sign"><svg viewBox="0 0 160 48" preserveAspectRatio="none"><path d="M6 30c8-1 12-18 18-18 5 0-2 24 5 24 5 0 8-14 13-14 4 0 2 10 7 10 6 0 10-8 18-9 9-1 18 2 28 3" fill="none" stroke="#4E36C9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg><small>Parent or carer</small></div></div><span class="hp-doc-chip"><i></i>Stays on this device</span>`,
  privacy: () => `<div class="pg-meta">${IMG('travel-08.webp', 560, 374)}<div class="pg-meta-card"><p class="pg-meta-h">Hidden data in this photo</p><ul><li>${svg('calendar')}<span>Date and time taken</span><em>Found</em></li><li>${svg('camera')}<span>Phone or camera model</span><em>Found</em></li><li>${svg('pin')}<span>GPS location</span><em>Found</em></li></ul><span class="pg-meta-act">Drop camera data</span></div></div>`,
  sizes: () => `<div class="pg-sizes"><figure class="s1">${IMG('people-08.webp', 960, 640)}<figcaption>Post · 1080 × 1080</figcaption></figure><figure class="s2">${IMG('garden-05.webp', 560, 374)}<figcaption>Portrait · 1080 × 1350</figcaption></figure><figure class="s3">${IMG('travel-08.webp', 560, 374)}<figcaption>Story · 1080 × 1920</figcaption></figure></div>`,
  background: () => `<div class="pg-bg">${IMG('garden-05.webp', 560, 374)}<div class="pg-bg-card"><span>Sunday</span><em>market</em><small>9 am · the old square</small></div><div class="pg-bg-ctl"><span><b>Blur</b><i style="--v:40%"></i></span><span><b>Dim</b><i style="--v:28%"></i></span></div></div>`,
  recipe: () => `<div class="pg-recipe"><div class="pg-recipe-card"><p class="hp-pn-eyebrow">Recipe</p><p class="hp-pn-title">Cinematic Portrait</p><ul><li><i></i>Exposure<b>+0.16</b></li><li><i></i>Warmth<b>+14</b></li><li><i></i>Contrast<b>+16</b></li><li><i></i>Vignette<b>32%</b></li></ul></div><div class="pg-recipe-thumbs">${IMG('people-08.webp', 960, 640)}${IMG('still-01.webp', 560, 374)}${IMG('garden-05.webp', 560, 374)}</div></div>`,
  edit: () => `<div class="pg-edit"><div class="pg-edit-photo">${IMG('still-01.webp', 560, 374)}<span class="pg-crop"><i></i><i></i><i></i><i></i></span></div><div class="pg-edit-ctl"><span><b>Brightness</b><i style="--v:58%"></i></span><span><b>Warmth</b><i style="--v:66%"></i></span><span><b>Contrast</b><i style="--v:54%"></i></span></div></div>`,
  text: () => `<div class="pg-text">${IMG('people-08.webp', 960, 640)}<div class="pg-text-sel"><span>Long light,</span><em>good friends.</em></div></div><div class="pg-text-fonts"><span class="on">Instrument Serif</span><span>Plus Jakarta Sans</span></div>`,
  brand: () => `<div class="pg-brand"><div class="pg-brand-card"><p class="pg-meta-h">Brand kit</p><div class="pg-swatches"><i style="background:#16131C"></i><i style="background:#E2B15A"></i><i style="background:#FBF8F3"></i><i style="background:#7457F0"></i><i style="background:#D07A45"></i></div><div class="pg-brand-type"><span class="serif">Aa</span><span>Aa</span></div><div class="pg-brand-logo"><span class="le-mark"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#E9BE6A"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#2A1F0A" stroke-width="1.9"/><circle cx="16" cy="16" r="2" fill="#2A1F0A"/></svg></span><b>Logo</b></div></div></div>`,
  convert: () => `<div class="pg-convert"><div class="pg-files"><span><b>DOCX</b>Worksheet</span><span><b>XLSX</b>Budget</span><span><b>PPTX</b>Slides</span></div><span class="pg-convert-arrow">${svg('arrow')}</span><div class="pg-pdfpage"><b>PDF</b><i></i><i class="m"></i><i></i><i class="s"></i></div></div>`,
  install: () => `<div class="pg-phone"><div class="pg-phone-screen"><span></span><span></span><span class="pg-app"><span class="le-mark"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#E9BE6A"/><circle cx="16" cy="16" r="7.5" fill="none" stroke="#2A1F0A" stroke-width="1.9"/><circle cx="16" cy="16" r="2" fill="#2A1F0A"/></svg></span><small>LocalEditor</small></span><span></span><span></span><span></span><span></span><span></span></div></div><span class="hp-doc-chip pg-chip-off"><i></i>Works offline</span>`,
  storage: () => `<div class="pg-store"><p class="pg-meta-h">Stored on this device</p><ul><li>${svg('collage')}<span>Saved designs</span><em>Clear</em></li><li>${svg('phone')}<span>App for offline use</span><em>Clear</em></li><li>${svg('text')}<span>Downloaded fonts</span><em>Clear</em></li><li>${svg('grid')}<span>Icons and graphics</span><em>Clear</em></li></ul></div>`,
  shop: () => `<div class="pg-shop">${IMG('still-01.webp', 560, 374)}<span class="pg-tag"><b>Morning set</b>Handmade ceramics</span><div class="pg-swatches pg-shop-sw"><i style="background:#16131C"></i><i style="background:#E2B15A"></i><i style="background:#FBF8F3"></i><i style="background:#D07A45"></i></div></div>`,
  code: () => `<div class="pg-code"><pre><code>{ "page": { "w": 1080, "h": 1350 },
  "layers": [ { "type": "text",
    "name": "Title", "text": "Hello" } ] }</code></pre></div>`,
};
function art(name) {
  if (!name || !ART[name]) return '';
  return `<figure class="pg-art pg-art-${name}" aria-hidden="true">${ART[name]()}</figure>`;
}

/* ---------- Hub pages ---------- */
function hubPage(site, e) {
  const trail = [['Home', '../', SITE], [e.title, './', SITE + e.url]];
  const sections = e.directory ? directoryHTML(site, e) : e.sections.map((s, i) => {
    const items = site.items(s.items);
    if (!items.length) return '';
    return `<section class="pg-group" aria-labelledby="pg-g${i}">
          <h2 class="pg-label" id="pg-g${i}">${esc(s.title)} <span>${items.length}</span></h2>
          <ul class="pg-list">
          ${items.map((it) => row(site, it, '../')).join('\n          ')}
          </ul>
        </section>`;
  }).join('\n        ');
  const listed = e.directory ? directoryItems(site, e) : [].concat(...e.sections.map((s) => site.items(s.items)));
  const graph = [
    { '@type': 'CollectionPage', name: e.title, url: SITE + e.url, description: e.description, isPartOf: { '@type': 'WebSite', name: 'LocalEditor', url: SITE },
      mainEntity: { '@type': 'ItemList', itemListElement: listed.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.title, url: SITE + (site.hasPage(it) ? it.url : it.launch) })) } },
    crumbsLD(trail),
    faqLD(e),
  ];
  const others = site.items(e.related).filter((r) => site.hasPage(r));
  const cta = e.launch ? `<div class="hp-cta"><a class="btn btn-gold btn-lg" href="../${e.launch}"${launchAttrs(e)}>${esc(e.launchLabel)}${svg('arrow')}</a></div>` : '';
  return head(site, e, graph) + `        ${crumbs(trail)}
        <section class="pg-hero${e.art ? '' : ' pg-hero-plain'}" aria-labelledby="pg-title">
          <div class="pg-hero-copy">
            <p class="eyebrow">${esc(e.eyebrow || e.title)}</p>
            <h1 id="pg-title">${headline(e.headline)}</h1>
            <p class="pg-lead">${esc(e.summary)}</p>
            ${cta}
            <p class="pg-for">${esc(e.audience)}</p>
          </div>
          ${e.directory ? '' : art(e.art)}
        </section>
        ${sections}
        ${privacyHTML(e, privacyTitle(e))}
        ${faqHTML(e, 'Short, honest answers.')}
        ${others.length ? `<section class="pg-more" aria-labelledby="pg-more-title">
          <h2 class="pg-label" id="pg-more-title">More ways in</h2>
          <ul class="pg-hubs pg-hubs-sm">
            ${others.map((o) => hubCard(o, '../')).join('\n            ')}
          </ul>
        </section>` : ''}` + tail(site);
}

function privacyTitle(e) {
  return { teachers: 'Student details stay on this device', office: 'Confidential files never leave this device', business: 'Your customers’ files stay with you', social: 'Drafts stay private until you post', 'privacy-tools': 'Checked here, kept here' }[e.id] || 'Your files stay on this device';
}

function hubCard(h, rel) {
  return `<li><a class="pg-hub" href="${rel}${h.url}"><span class="hp-tool-ic">${svg(h.icon)}</span><span><b>${esc(h.title)}</b><small>${esc(h.tagline)}</small></span><span class="pg-row-arrow">${svg('arrow')}</span></a></li>`;
}

/* The every-tool hub reuses the homepage directory: app.js filters [data-tool-dir]. */
function directoryItems(site, e) {
  const studio = [].concat(...e.sections.map((s) => site.items(s.items)));
  return studio.concat(site.tools.map((t) => site.byId.get('tool:' + t.slug)));
}
function directoryHTML(site, e) {
  const groups = e.sections.map((s) => ({ id: s.group || 'studio', name: s.title, items: site.items(s.items) }))
    .concat(site.cats.map((c) => ({ id: c.id, name: c.name.replace(/ &.*$/, '').replace(/ tools$/, ''), full: c.name, items: site.tools.filter((t) => t.cat === c.id).map((t) => site.byId.get('tool:' + t.slug)) })))
    .filter((g) => g.items.length);
  const chip = (id, name, on) => `<button type="button" class="chip" data-dir-cat="${id}" aria-pressed="${on ? 'true' : 'false'}">${esc(name)}</button>`;
  const li = (it) => {
    const k = (it.title + ' ' + it.tagline + ' ' + (it.keywords || []).join(' ')).toLowerCase();
    return `<li><a class="hp-tool" href="../${site.hasPage(it) ? it.url : it.launch}" data-k="${esc(k)}"><span class="hp-tool-ic">${svg(it.icon)}</span><span><b>${esc(it.title)}</b><small>${esc(it.tagline)}</small></span></a></li>`;
  };
  return `<section class="pg-dir" data-tool-dir aria-label="Every tool">
          <div class="hp-dir-bar">
            <div class="hp-dir-search">
              ${svg('search')}
              <label class="sr-only" for="pg-dir-q">Search tools</label>
              <input id="pg-dir-q" type="search" placeholder="Search, for example “merge” or “resize”" autocomplete="off" enterkeyhint="search" data-dir-search>
            </div>
            <div class="hp-chips" role="group" aria-label="Filter by kind">
              ${chip('all', 'All', true)}
              ${groups.map((g) => chip(g.id, g.name, false)).join('\n              ')}
            </div>
            <p class="sr-only" aria-live="polite" data-dir-status></p>
          </div>
          ${groups.map((g) => `<section class="hp-dir-group" data-dir-group="${g.id}" id="${g.id}" aria-labelledby="dir-${g.id}">
            <h2 class="hp-dir-label" id="dir-${g.id}">${esc(g.full || g.name)} <span>${g.items.length}</span></h2>
            <ul class="hp-dir-list">
              ${g.items.map(li).join('\n              ')}
            </ul>
          </section>`).join('\n          ')}
          <p class="hp-dir-empty" data-dir-empty hidden>No tool matches “<span data-dir-query></span>”. The <a href="../studio/">photo studio</a> and <a href="../pdf-studio/">PDF studio</a> cover most jobs.</p>
        </section>`;
}

/* ---------- Feature pages ---------- */
function featurePage(site, e) {
  const parent = site.items(e.parents).find((p) => site.hasPage(p));
  const trail = [['Home', '../', SITE], [parent.title, '../' + parent.url, SITE + parent.url], [e.title, './', SITE + e.url]];
  const app = {
    '@type': 'SoftwareApplication', name: plain(e.title) + ' — LocalEditor', url: SITE + e.url, description: e.description,
    applicationCategory: e.parents.includes('pdf') ? 'BusinessApplication' : 'DesignApplication', operatingSystem: 'Any',
    browserRequirements: 'A current version of Chrome, Edge, Safari or Firefox', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, featureList: e.does,
  };
  const related = site.items(e.related);
  const hubs = site.items([].concat(e.parents || [], e.audiences || [])).filter((h) => site.hasPage(h));
  const second = e.secondary ? `<a class="btn btn-ghost btn-lg" href="../${e.secondary.href}">${esc(e.secondary.label)}</a>` : '';
  return head(site, e, [app, crumbsLD(trail), faqLD(e)]) + `        ${crumbs(trail)}
        <section class="pg-hero" aria-labelledby="pg-title">
          <div class="pg-hero-copy">
            <p class="eyebrow">${esc(e.title)}${e.status === 'beta' ? ' · Beta' : ''}</p>
            <h1 id="pg-title">${headline(e.headline)}</h1>
            <p class="pg-lead">${esc(e.summary)}</p>
            <div class="hp-cta">
              <a class="btn btn-gold btn-lg" href="../${e.launch}"${launchAttrs(e)}>${esc(e.launchLabel)}${svg('arrow')}</a>
              ${second}
            </div>
            <p class="hp-kicker pg-kicker"><span>${svg('check')}Free</span><span>${svg('check')}No account</span><span>${svg('check')}Nothing uploaded</span></p>
          </div>
          ${art(e.art)}
        </section>
        <section class="pg-how" aria-label="What it does and how it works">
          <div>
            <h2 class="pg-label">What it does</h2>
            <ul class="pg-checks">
              ${e.does.map((d) => `<li>${svg('check')}<span>${esc(d)}</span></li>`).join('\n              ')}
            </ul>
          </div>
          <div>
            <h2 class="pg-label">How it works</h2>
            <ol class="pg-steps">
              ${e.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('\n              ')}
            </ol>
          </div>
        </section>
        ${privacyHTML(e, 'Your files stay on this device')}
        ${faqHTML(e, 'Short, honest answers.')}
        ${related.length ? `<section class="pg-group" aria-labelledby="pg-rel-title">
          <h2 class="pg-label" id="pg-rel-title">Goes well with</h2>
          <ul class="pg-list">
          ${related.map((r) => row(site, r, '../')).join('\n          ')}
          </ul>
        </section>` : ''}
        ${hubs.length ? `<p class="pg-also">Part of ${hubs.map((h) => `<a href="../${h.url}">${esc(h.title)}</a>`).join(', ').replace(/, ([^,]*)$/, ' and $1')}.</p>` : ''}
        <section class="hp-close pg-close" aria-labelledby="pg-close-title">
          <h2 id="pg-close-title">${esc(e.title)}, <em>on this device.</em></h2>
          <p>${esc(e.tagline)}. It opens in this browser and keeps your files on this device.</p>
          <div class="hp-cta"><a class="btn btn-gold btn-lg" href="../${e.launch}"${launchAttrs(e)}>${esc(e.launchLabel)}</a></div>
        </section>` + tail(site);
}

/* ---------- Shared files: app.js block, homepage lists, llms.txt ---------- */
function replaceBlock(text, begin, end, body, file) {
  const a = text.indexOf(begin), b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(file + ': markers ' + begin + ' … ' + end + ' not found');
  return text.slice(0, a + begin.length) + body + text.slice(b);
}

function appIndex(site) {
  const hubs = site.hubs.map((h) => [h.title, h.url, h.tagline, h.icon]);
  const pages = site.features.map((f) => [f.title, f.url, f.tagline, (f.keywords || []).join(' ')]);
  return '\n  var HUBS = ' + JSON.stringify(hubs) + ';\n  var PAGES = ' + JSON.stringify(pages) + ';\n  ';
}

function homeHubs(site) {
  return '\n            ' + site.hubs.map((h) => hubCard(h, '')).join('\n            ') + '\n          ';
}
function homeFootHubs(site) {
  return '\n              ' + site.hubs.map((h) => `<a href="${h.url}">${esc(h.title)}</a>`).join('\n              ') + '\n            ';
}

function llms(site) {
  const lines = ['## Find by need', ''];
  site.hubs.forEach((h) => {
    lines.push(`- [${h.title}](${SITE}${h.url}): ${h.tagline}.`);
  });
  lines.push('', '## Features', '');
  site.features.forEach((f) => lines.push(`- [${f.title}](${SITE}${f.url}): ${f.tagline}.${f.status === 'beta' ? ' (Beta)' : ''}`));
  return lines.join('\n') + '\n\n';
}
function patchLlms(site) {
  const file = path.join(ROOT, 'llms.txt');
  if (!fs.existsSync(file)) return;
  let t = fs.readFileSync(file, 'utf8');
  t = t.replace(/## Find by need\n[\s\S]*?(?=## Optional)/, '');
  const body = llms(site);
  t = t.includes('## Optional') ? t.replace('## Optional', body + '## Optional') : t + '\n' + body;
  write(file, t);
}

function write(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

/* Top-level folders holding a generated page that site.json no longer asks for. */
function stale(site) {
  const keep = new Set(site.pages.map((e) => e.url.replace(/\/$/, '')));
  return fs.readdirSync(ROOT).filter((d) => {
    const f = path.join(ROOT, d, 'index.html');
    return !keep.has(d) && fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(MARK);
  });
}

function build(opts) {
  opts = opts || {};
  const site = load();
  const changed = [];
  for (const e of site.pages) {
    const html = e.kind === 'feature' ? featurePage(site, e) : hubPage(site, e);
    if (write(path.join(ROOT, e.url, 'index.html'), html)) changed.push(e.url);
  }
  for (const d of stale(site)) {
    fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
    changed.push(d + '/ (removed)');
  }
  const appFile = path.join(ROOT, 'assets/js/app.js');
  const app = fs.readFileSync(appFile, 'utf8');
  if (write(appFile, replaceBlock(app, '/* BEGIN site index */', '/* END site index */', appIndex(site), 'app.js'))) changed.push('assets/js/app.js');
  const homeFile = path.join(ROOT, 'index.html');
  let home = fs.readFileSync(homeFile, 'utf8');
  home = replaceBlock(home, '<!-- BEGIN hubs -->', '<!-- END hubs -->', homeHubs(site), 'index.html');
  home = replaceBlock(home, '<!-- BEGIN foot hubs -->', '<!-- END foot hubs -->', homeFootHubs(site), 'index.html');
  if (write(homeFile, home)) changed.push('index.html');
  patchLlms(site);
  if (!opts.quiet) console.log(`Pages: ${site.hubs.length} hubs, ${site.features.length} feature pages${changed.length ? '; changed ' + changed.join(', ') : '; nothing changed'}.`);
  return { site, changed };
}

/* Feature pages are small and one tap from a hub, so they are left out of the offline precache;
   the hubs are precached. site.json is build input only. */
let skipCache = null;
function notPrecached(file) {
  if (file === 'assets/data/site.json') return true;
  if (!skipCache) {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      skipCache = new Set(raw.entries.filter((e) => e.kind === 'feature' && e.url).map((e) => e.url + 'index.html'));
    } catch (err) { skipCache = new Set(); }
  }
  return skipCache.has(file);
}

module.exports = { build, load, notPrecached, llms, patchLlms, MARK, VISIBLE };

if (require.main === module) build();
