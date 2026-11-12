#!/usr/bin/env node
/* Generates index.html, about/, 404.html, offline.html, manifest, sitemap.xml, robots.txt, llms.txt and sw.js.
   Run from repo root:  node scripts/build.js
   LE_BUILD_VERSION=abc node scripts/build.js pins the worker version (tests, reproducible deploys).
   require('./scripts/build.js') only exposes the generators (manifestJSON, precacheList, swSource) and writes nothing. */
const fs = require('fs');
const path = require('path');
const PAGES = require('./build-pages'); // category hubs and feature pages (assets/data/site.json)
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://localeditor.net/';
const VERSION = process.env.LE_BUILD_VERSION || new Date().toISOString().replace(/\D/g, '').slice(0, 12);

const I = { // 24x24 stroke icons
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  convert: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  rotate: '<path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>',
  drop: '<path d="M12 2.7 5.6 9.1a9 9 0 1 0 12.8 0z"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  pipette: '<path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  merge: '<path d="M8 6h10a2 2 0 0 1 2 2v12"/><rect x="2" y="2" width="12" height="16" rx="2"/>',
  split: '<path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8"/>',
  img2pdf: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  pdf2img: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  stamp: '<path d="M5 22h14M19.3 14.3A2 2 0 0 0 18 14H6a2 2 0 0 0-2 2v2h16v-2a2 2 0 0 0-.7-1.7zM14 14V9.5a4 4 0 1 0-4 0V14"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  case: '<path d="M3 18 7.5 6 12 18M4.7 14h5.6M15 13a3 3 0 1 0 6 0v5M21 13a3 3 0 1 0-6 0"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  binary: '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4M14 10h4M6 14h2v6M14 4h2v6"/>',
  fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 1 0 4-1 6M14 13.1c0 2.5 0 5-1 7.4M17.3 21c.3-1 .6-2 .7-3M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .1-5.3 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .3-2M8.7 6.8A6 6 0 0 1 18 12c0 .5 0 1.4-.1 2.4"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7h2A5.6 5.6 0 0 0 22 11c0-5-4.5-9-10-9z"/>',
  diff: '<path d="M12 3v14M5 10h14M5 21h14"/>',
  para: '<path d="M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  id: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  numbers: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 18h4M12 12v6"/>',
};

const CATS = [
  { id: 'image', emoji: '📸', name: 'Image tools', blurb: 'Compress, resize, convert, crop and edit photos without uploading them.' },
  { id: 'pdf', emoji: '📄', name: 'PDF tools', blurb: 'Merge, split, convert, rotate and stamp PDFs entirely on your device.' },
  { id: 'text', emoji: '✍️', name: 'Text tools', blurb: 'Count, transform, compare and generate text instantly.' },
  { id: 'dev', emoji: '⚡', name: 'Developer & everyday utilities', blurb: 'QR codes, passwords, JSON, hashes, units, colors and IDs.' },
];

const TOOLS = [
  ['image', 'image-compressor', 'Image Compressor', 'Shrink JPG, PNG & WebP file size without visible quality loss.', 'compress'],
  ['image', 'image-resizer', 'Image Resizer', 'Resize photos to exact pixels, percent or social presets.', 'resize'],
  ['image', 'image-converter', 'Image Converter', 'Convert between JPG, PNG and WebP in bulk.', 'convert'],
  ['image', 'image-cropper', 'Image Cropper', 'Crop to any size or aspect ratio like 1:1 or 16:9.', 'crop'],
  ['image', 'rotate-flip-image', 'Rotate & Flip Image', 'Rotate by any angle and mirror horizontally or vertically.', 'rotate'],
  ['image', 'watermark-image', 'Watermark Image', 'Stamp text or a logo on photos — single or tiled.', 'stamp'],
  ['image', 'image-to-base64', 'Image to Base64', 'Turn images into data URLs and back again.', 'code'],
  ['image', 'color-picker', 'Image Color Picker', 'Pick exact colors and extract palettes from any image.', 'pipette'],
  ['image', 'favicon-generator', 'Favicon Generator', 'Create favicon.ico and app icons from an image or emoji.', 'star'],
  ['image', 'image-filters', 'Photo Filters & Editor', 'Adjust brightness, contrast, saturation and apply filters.', 'sliders'],
  ['image', 'photo-privacy', 'Photo Privacy Check', 'See and remove hidden location, time and camera details in a photo.', 'shield'],
  ['pdf', 'merge-pdf', 'Merge PDF', 'Combine multiple PDFs into one in the order you choose.', 'merge'],
  ['pdf', 'split-pdf', 'Split PDF', 'Extract page ranges or split every page into its own file.', 'split'],
  ['pdf', 'jpg-to-pdf', 'JPG to PDF', 'Convert JPG, PNG and WebP images into a single PDF.', 'img2pdf'],
  ['pdf', 'pdf-to-jpg', 'PDF to JPG', 'Turn every PDF page into a high-quality JPG or PNG.', 'pdf2img'],
  ['pdf', 'rotate-pdf', 'Rotate PDF', 'Rotate one page or all pages and save permanently.', 'rotate'],
  ['pdf', 'organize-pdf', 'Organize PDF', 'Reorder, delete, duplicate and insert PDF pages.', 'layers'],
  ['pdf', 'add-page-numbers', 'Add Page Numbers', 'Number PDF pages with custom position and format.', 'numbers'],
  ['pdf', 'watermark-pdf', 'Watermark PDF', 'Add a text watermark such as CONFIDENTIAL to every page.', 'stamp'],
  ['text', 'word-counter', 'Word Counter', 'Count words, characters, sentences and reading time.', 'text'],
  ['text', 'case-converter', 'Case Converter', 'UPPER, lower, Title, camelCase, snake_case and more.', 'case'],
  ['text', 'text-diff', 'Text Compare (Diff)', 'Highlight differences between two texts line by line.', 'diff'],
  ['text', 'lorem-ipsum-generator', 'Lorem Ipsum Generator', 'Generate placeholder paragraphs, sentences or words.', 'para'],
  ['dev', 'qr-code-generator', 'QR Code Generator', 'Make QR codes for URLs, Wi-Fi, contacts — PNG & SVG.', 'qr'],
  ['dev', 'password-generator', 'Password Generator', 'Create strong random passwords and passphrases.', 'key'],
  ['dev', 'json-formatter', 'JSON Formatter', 'Beautify, minify and validate JSON with error hints.', 'braces'],
  ['dev', 'base64-encoder', 'Base64 Encode / Decode', 'Encode and decode Base64 text and files with UTF-8.', 'binary'],
  ['dev', 'hash-generator', 'Hash Generator', 'MD5, SHA-1, SHA-256 and SHA-512 for text and files.', 'fingerprint'],
  ['dev', 'unit-converter', 'Unit Converter', 'Length, weight, temperature, data and 6 more categories.', 'ruler'],
  ['dev', 'color-converter', 'Color Converter', 'HEX, RGB, HSL, CMYK conversion with contrast checker.', 'palette'],
  ['dev', 'uuid-generator', 'UUID Generator', 'Bulk-generate UUID v4 and v7 and validate UUIDs.', 'id'],
  ['dev', 'device-check', 'Device Check', 'See which features work on this device and browser, and which browser unlocks more.', 'phone'],
].map(([cat, slug, name, desc, icon]) => ({ cat, slug, name, desc, icon }));

const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const head = ({ title, desc, url, rootRel, extra = '' }) => `<!doctype html>
<html lang="en" data-root="${rootRel}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#141318">
<link rel="manifest" href="${rootRel}manifest.webmanifest">
<link rel="icon" href="${rootRel}assets/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${rootRel}assets/icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="LocalEditor">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LocalEditor">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}assets/icons/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${rootRel}assets/css/app.css">
<script>try{var t=localStorage.getItem('le-theme')||localStorage.getItem('it-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
${extra}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
`;

const foot = (rootRel) => `<footer class="site-footer"><div class="container">
  <span>© ${new Date().getFullYear()} LocalEditor · Files stay on this device.</span>
  <span><a href="${rootRel}">All tools</a> · <a href="${rootRel}about/">About &amp; privacy</a> · <a href="${rootRel}llms.txt">llms.txt</a></span>
</div></footer>
<script src="${rootRel}assets/js/app.js"></script>
</body>
</html>
`;

const card = (t, rootRel) => `<a class="tool-card cat-${t.cat}" href="${rootRel}${t.slug}/" data-search="${esc((t.name + ' ' + t.desc + ' ' + t.slug).toLowerCase())}"><span class="ti">${svg(t.icon)}</span><span><h3>${t.name}</h3><p>${t.desc}</p></span></a>`;

const FAQ = [
  ['Are these tools really free?', 'Yes. All 30 tools are completely free with no sign-up, no watermarks on your output, no daily limits and no ads in the workflow.'],
  ['Are my files uploaded to a server?', 'No. Every tool runs entirely inside your browser using JavaScript, Canvas, Web Crypto, pdf-lib and pdf.js. Your images, PDFs and text never leave your device.'],
  ['Can I use the tools offline?', 'Yes. LocalEditor is a Progressive Web App. After your first visit, every tool is cached on your device and keeps working without an internet connection.'],
  ['How do I install LocalEditor on my phone?', 'On Android (Chrome, Edge, Samsung Internet) tap "Install app" or use the browser menu → "Install app". On iPhone or iPad open the site in Safari, tap Share → "Add to Home Screen". It then opens full-screen like a native app.'],
  ['Which browsers are supported?', 'Any modern browser: Chrome, Edge, Safari, Firefox, Samsung Internet and Opera on desktop, Android and iOS.'],
  ['Is there a file size limit?', 'There is no artificial limit. Because processing happens on your device, the practical limit depends on your device memory — typically hundreds of MB on desktop and tens of MB on phones.'],
];

function buildIndex() {
  const existing = fs.existsSync(path.join(ROOT, 'index.html')) ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : '';
  if (existing.includes('le-built')) {
    console.log('Keeping the LocalEditor homepage.');
    return;
  }
  const ld = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', name: 'LocalEditor', url: SITE, description: '30 free, private, offline-capable browser tools for images, PDFs, text and developers.', inLanguage: 'en' },
      { '@type': 'Organization', name: 'LocalEditor', url: SITE, logo: SITE + 'assets/icons/icon-512.png' },
      { '@type': 'ItemList', name: 'LocalEditor — all tools', numberOfItems: TOOLS.length, itemListElement: TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: SITE + t.slug + '/' })) },
      { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  };
  const sections = CATS.map((c) => `
  <section id="${c.id}" class="cat-section" aria-labelledby="h-${c.id}">
    <div class="section-title"><h2 id="h-${c.id}">${c.emoji} ${c.name}</h2><span class="muted">${TOOLS.filter((t) => t.cat === c.id).length} tools</span></div>
    <p class="muted" style="margin-top:-6px">${c.blurb}</p>
    <div class="tools-grid">${TOOLS.filter((t) => t.cat === c.id).map((t) => card(t, '')).join('\n')}</div>
  </section>`).join('\n');

  const html = head({
    title: 'LocalEditor — 30 Free Image, PDF & Text Tools (Offline)',
    desc: '30 free online tools to compress images, merge PDFs, convert JPG to PDF, make QR codes and more. Private: no uploads, works offline, installs on any phone.',
    url: SITE, rootRel: '',
    extra: `<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
.home-hero{padding:72px 0 32px}
.search{max-width:580px;margin:28px auto 0;position:relative}
.search svg{position:absolute;left:18px;top:50%;transform:translateY(-50%);width:22px;height:22px;color:var(--faint);transition:color .2s}
.search:focus-within svg{color:var(--brand)}
.search input{padding-left:52px;min-height:58px;border-radius:20px;font-size:1.06rem;box-shadow:var(--shadow),0 0 0 1px var(--brand-glow);border-color:var(--border)}
.search input:focus{border-color:var(--brand);box-shadow:var(--shadow-lg),0 0 0 4px var(--brand-glow)}
.chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px}
.why{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:48px 0}
.why .card{padding:24px;transition:border-color .2s ease,box-shadow .2s ease}
.why .card:hover{box-shadow:var(--shadow-sm);border-color:var(--border-hover)}
.why h3{margin-bottom:6px;font-size:1.1rem}
.why p{margin:0;color:var(--muted);font-size:.94rem;line-height:1.55}
.why .wi{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,var(--brand),var(--brand-2));color:#fff;display:grid;place-items:center;margin-bottom:14px;box-shadow:0 4px 14px var(--brand-glow);transition:transform .3s}
.why .card:hover .wi{transform:scale(1.12) rotate(-6deg)}
.why .wi svg{width:22px;height:22px}
.empty{display:none;text-align:center;padding:36px;color:var(--muted);font-size:1.05rem}
.install-cta{display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:32px;margin:44px 0;background:linear-gradient(135deg,var(--brand-soft),color-mix(in srgb,var(--brand-2) 10%,transparent));border:1.5px solid color-mix(in srgb,var(--brand) 30%,var(--border));border-radius:var(--radius);position:relative;overflow:hidden}
.install-cta::before{content:'';position:absolute;top:0;right:0;width:240px;height:240px;background:radial-gradient(circle,var(--brand-glow) 0%,transparent 70%);border-radius:50%;pointer-events:none}
</style>`,
  }) + `
<main id="main" class="container">
  <section class="hero home-hero">
    <div class="hero-ambient-img" style="background-image:url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80');" aria-hidden="true"></div>
    <span class="hero-float-icon hero-float-1" aria-hidden="true">📸</span>
    <span class="hero-float-icon hero-float-2" aria-hidden="true">📄</span>
    <span class="hero-float-icon hero-float-3" aria-hidden="true">⚡</span>
    <span class="hero-float-icon hero-float-4" aria-hidden="true">🎨</span>
    <span class="eyebrow">✨ 30 Free Tools · 100% In Your Browser</span>
    <h1>Every everyday tool,<br><span class="gradient-text">instant, private &amp; offline.</span></h1>
    <p class="lead">LocalEditor is a free, awwwards-worthy collection of 30 browser-based utilities for photos, PDFs, text, and developers. Files are processed locally on your device — never uploaded — and the app installs on any phone to work anywhere, anytime.</p>
    <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <label for="q" class="skip">Search tools</label><input id="q" class="input" type="search" placeholder="Search tools — compress, pdf, qr code, diff…" autocomplete="off"></div>
    <nav class="chips" aria-label="Categories">${CATS.map((c) => `<a class="chip" href="#${c.id}">${c.emoji} ${c.name.replace(' & everyday utilities', '')}</a>`).join('')}</nav>
    <div class="trust">
      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>🆓 Free forever</span>
      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>🔒 No sign-up</span>
      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>☁️ No uploads</span>
      <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>📴 Works offline</span>
    </div>
  </section>

  <div id="all-tools">
  ${sections}
  <p class="empty" id="empty">No tools match your search. Try searching for "pdf", "image", or "json".</p>
  </div>

  <section class="card install-cta" aria-labelledby="h-install">
    <div><h2 id="h-install" style="margin-bottom:6px">🚀 Install it. Use it offline.</h2><p class="muted" style="margin:0;font-size:1.02rem">Add LocalEditor to your home screen — all 30 tools work on a flight, in the subway, anywhere without Wi-Fi.</p></div>
    <div class="row"><button class="btn btn-primary" type="button" data-le-install>Install app</button><a class="btn" href="about/#install">How to install</a></div>
  </section>

  <section class="why" aria-label="Why LocalEditor">
    <div class="card"><div class="wi">${svg('key')}</div><h3>🔒 Private by design</h3><p>Processing happens with Web APIs on your device. Nothing is uploaded, logged or stored on a server.</p></div>
    <div class="card"><div class="wi">${svg('compress')}</div><h3>⚡ Instant results</h3><p>No queues, no waiting for file transfers — results render instantly as fast as your device can compute.</p></div>
    <div class="card"><div class="wi">${svg('layers')}</div><h3>📴 Works offline</h3><p>A service worker caches every tool, so once loaded they keep running seamlessly with no internet connection.</p></div>
    <div class="card"><div class="wi">${svg('star')}</div><h3>✨ No limits, no watermarks</h3><p>Unlimited files, unlimited usage, crystal-clean exports. No account, no ads in workflow, no paywall.</p></div>
  </section>

  <section class="card faq" style="padding:32px;margin-bottom:48px" aria-labelledby="h-faq">
    <h2 id="h-faq">💡 Frequently asked questions</h2>
    ${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('\n    ')}
  </section>
</main>
<script>
(function(){var q=document.getElementById('q'),cards=[].slice.call(document.querySelectorAll('.tool-card')),secs=[].slice.call(document.querySelectorAll('.cat-section')),empty=document.getElementById('empty');
q.addEventListener('input',function(){var v=q.value.trim().toLowerCase(),n=0;cards.forEach(function(c){var m=!v||v.split(/\\s+/).every(function(w){return c.dataset.search.indexOf(w)>-1});c.style.display=m?'':'none';if(m)n++});
secs.forEach(function(s){s.style.display=[].some.call(s.querySelectorAll('.tool-card'),function(c){return c.style.display!=='none'})?'':'none'});empty.style.display=n?'none':'block'});
document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus()}});})();
</script>
` + foot('');
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);
}

function buildAbout() {
  fs.mkdirSync(path.join(ROOT, 'about'), { recursive: true });
  const html = head({
    title: 'Privacy — LocalEditor',
    desc: 'LocalEditor edits images, PDFs, and text in the browser. Files are not uploaded.',
    url: SITE + 'about/',
    rootRel: '../'
  }) + `
<main id="main" class="container" style="max-width:860px">
  <section class="hero"><span class="eyebrow">Privacy</span><h1>The file stays on this device</h1>
  <p class="lead">LocalEditor is a set of ${TOOLS.length} utilities that run inside the browser. Nothing is uploaded.</p></section>
  <div class="content">
    <section class="card"><h2>Privacy</h2><p>Image edits use the canvas. PDFs use pdf-lib and pdf.js. Hashes and passwords use the Web Crypto API. There is no account, and the pages do not send the file to a server. After the app is installed, the tools that have already loaded keep working without a connection.</p></section>
    <section class="card" id="install"><h2>Install</h2>
      <ul><li><b>Android (Chrome, Edge, Samsung Internet):</b> tap <i>Install app</i> in the header, or open the browser menu and choose <i>Install app</i> / <i>Add to Home screen</i>.</li>
      <li><b>iPhone &amp; iPad (Safari):</b> tap the Share button, then <i>Add to Home Screen</i>.</li>
      <li><b>Desktop (Chrome, Edge):</b> click the install icon in the address bar.</li></ul>
      <p style="margin-top:1em">After your first visit, all ${TOOLS.length} tools and their libraries are cached locally for permanent offline use.</p></section>
    <section class="card"><h2>Every tool</h2><div class="tools-grid">${TOOLS.map((t) => card(t, '../')).join('\n')}</div></section>
  </div>
</main>
` + foot('../');
  fs.writeFileSync(path.join(ROOT, 'about/index.html'), html);

  const missing = TOOLS.filter((t) => ['image-compressor', 'merge-pdf', 'jpg-to-pdf', 'qr-code-generator', 'word-counter', 'pdf-to-jpg'].includes(t.slug));
  const notFound = head({
    title: 'Page not found — LocalEditor',
    desc: 'This page does not exist. Browse private browser tools for images, PDFs and text.',
    url: SITE + '404.html',
    rootRel: '/'
  }).replace('<meta name="robots" content="index,follow,max-image-preview:large">', '<meta name="robots" content="noindex">') +
    '<main id="main" class="container"><section class="hero"><span class="eyebrow">404</span><h1>Page not found</h1><p class="lead">Try one of these instead.</p></section><div class="tools-grid" style="margin-bottom:48px">' +
    missing.map((t) => card(t, '/')).join('\n') +
    '</div></main>' + foot('/');
  fs.writeFileSync(path.join(ROOT, '404.html'), notFound);
}

/* ---------- Manifest ---------- */
/* Screenshots are captured by scripts/screenshots.js. A missing file is left out so the manifest never points at a 404. */
const SCREENSHOTS = [
  { src: 'assets/screenshots/studio-narrow.webp', sizes: '780x1688', form_factor: 'narrow', label: 'The photo studio on a phone: layers, text and filters, all on your device' },
  { src: 'assets/screenshots/home-narrow.webp', sizes: '780x1688', form_factor: 'narrow', label: 'Every tool in one place, working offline' },
  { src: 'assets/screenshots/studio-wide.webp', sizes: '1440x900', form_factor: 'wide', label: 'Design with layers, templates and collages' },
  { src: 'assets/screenshots/home-wide.webp', sizes: '1440x900', form_factor: 'wide', label: 'A private photo studio, a PDF studio and 30 tools' },
];
const SHORTCUTS = [
  { name: 'Photo studio', short_name: 'Studio', description: 'Start a new design', url: './studio/', icon: 'studio' },
  { name: 'Make a collage', short_name: 'Collage', description: 'Arrange several photos', url: './studio/?tool=collage', icon: 'collage' },
  { name: 'PDF studio', short_name: 'PDF', description: 'Edit, sign and fill PDFs', url: './pdf-studio/', icon: 'pdf' },
  { name: 'Protect a PDF', short_name: 'Protect', description: 'Lock a PDF with a password, on this device', url: './pdf-studio/?panel=bulk&job=protect', icon: 'protect' },
];
const IMAGE_TYPES = { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/gif': ['.gif'], 'image/avif': ['.avif'] };

function manifestJSON() {
  const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
  const icon192 = [{ src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' }];
  return {
    id: '/',
    name: 'LocalEditor',
    short_name: 'LocalEditor',
    description: 'A private photo studio, PDF studio and everyday tools. Everything stays on your device and works offline.',
    lang: 'en',
    dir: 'ltr',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#E7E5EB',
    theme_color: '#141318',
    categories: ['photo', 'productivity', 'utilities', 'graphics'],
    prefer_related_applications: false,
    icons: [
      { src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'assets/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'assets/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    screenshots: SCREENSHOTS.filter((s) => exists(s.src)).map((s) => Object.assign({ type: 'image/webp' }, s)),
    shortcuts: SHORTCUTS.map((s) => {
      const file = `assets/icons/shortcuts/${s.icon}-96.png`;
      return { name: s.name, short_name: s.short_name, description: s.description, url: s.url, icons: exists(file) ? [{ src: file, sizes: '96x96', type: 'image/png' }] : icon192 };
    }),
    file_handlers: [{
      action: './studio/',
      accept: Object.assign({
        'application/vnd.localeditor.project+zip': ['.leproject'],
        'application/vnd.localeditor.workflow+json': ['.leworkflow'],
      }, IMAGE_TYPES),
      icons: icon192,
      launch_type: 'single-client',
    }],
    share_target: {
      action: './studio/?share-target=1',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'media', accept: ['image/*', '.leproject', '.leworkflow'] }] },
    },
    launch_handler: { client_mode: ['navigate-existing', 'auto'] },
  };
}

function buildMeta() {
  fs.writeFileSync(path.join(ROOT, 'manifest.webmanifest'), JSON.stringify(manifestJSON(), null, 2) + '\n');


  const today = new Date().toISOString().slice(0, 10);
  const urls = [''];
  for (const entry of fs.readdirSync(ROOT)) {
    if (fs.existsSync(path.join(ROOT, entry, 'index.html'))) urls.push(entry + '/');
  }
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><priority>${u === '' ? '1.0' : u === 'about/' ? '0.5' : '0.8'}</priority></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\n# AI / answer engines are welcome\nUser-agent: GPTBot\nAllow: /\nUser-agent: OAI-SearchBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

  const llms = `# LocalEditor

> LocalEditor is a private image studio plus ${TOOLS.length} browser tools for images, PDFs, text, and everyday tasks. Editing runs on the device. Files are not uploaded, no account is required, and the site can be installed for offline use.

Key facts:
- Price: free, unlimited, no watermarks, no sign-up.
- Privacy: all processing happens on the user's device; no server receives files.
- Offline: a service worker caches every tool after the first visit.
- Install: Android/desktop via "Install app"; iOS via Safari Share → Add to Home Screen.

${CATS.map((c) => `## ${c.name}\n\n${TOOLS.filter((t) => t.cat === c.id).map((t) => `- [${t.name}](${SITE}${t.slug}/): ${t.desc}`).join('\n')}`).join('\n\n')}

## Optional

- [About & privacy](${SITE}about/): how the tools work and how to install them.
- [Sitemap](${SITE}sitemap.xml)
`;
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), llms);
}


/* Shown by the worker when someone opens a page offline that was never saved on this device. */
function buildOffline() {
  const links = [['', 'Home'], ['studio/', 'Photo studio'], ['pdf-studio/', 'PDF studio'], ['convert-to-pdf/', 'Convert to PDF'], ['image-compressor/', 'Compress a photo'], ['merge-pdf/', 'Merge PDF']];
  const html = head({
    title: 'Offline — LocalEditor',
    desc: 'You are offline. Everything saved on this device keeps working.',
    url: SITE + 'offline.html',
    rootRel: '/'
  }).replace('<meta name="robots" content="index,follow,max-image-preview:large">', '<meta name="robots" content="noindex">') +
    '<main id="main" class="container" style="max-width:720px"><section class="hero"><span class="eyebrow">Offline</span><h1>This page is not on this device yet</h1>' +
    '<p class="lead">You are offline, and this page was never opened here before. Everything below is saved on this device and works without a connection.</p></section>' +
    '<div class="content"><section class="card"><ul>' + links.map(([u, n]) => `<li><a href="/${u}">${n}</a></li>`).join('') + '</ul>' +
    '<p style="margin-top:1em"><a class="btn" href="">Try again</a></p></section></div></main>' + foot('/');
  fs.writeFileSync(path.join(ROOT, 'offline.html'), html);
}

/* ---------- Service worker ---------- */
/* Never shipped to the precache: build tooling, docs, tests, infra. */
const SKIP = ['scripts', 'node_modules', 'tests', 'docs', 'infra', 'sw.js', 'README.md', 'CLAUDE.md', 'llms.txt', 'robots.txt', 'sitemap.xml', 'og.png'];
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.') || SKIP.includes(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return out;
}
/* Downloaded on request and owned by a runtime cache (listed in the storage manager), never precached. */
const ON_DEMAND = /^assets\/vendor\/tesseract\/|^assets\/vendor\/pdf-lib-crypt|^assets\/vendor\/ort|^labs\/|^assets\/fonts\/library\/|^assets\/data\/(lucide|phosphor|emoji)\.json$|^assets\/data\/withicons\/|^assets\/photos\/|^assets\/data\/collages\/|^assets\/models\/|^assets\/screenshots\//;
/* If one of these fails to download, the new version is not installed (the old one keeps working). */
const CRITICAL = ['./', './offline.html', './studio/', './assets/js/app.js', './assets/css/app.css', './assets/js/le-pwa.js', './assets/css/le-pwa.css', './manifest.webmanifest'];

function precacheList() {
  return walk(ROOT).filter((f) => !ON_DEMAND.test(f) && !PAGES.notPrecached(f)).map((f) => f.endsWith('index.html') ? f.replace(/index\.html$/, '') : f).map((f) => './' + f).sort();
}

/* The worker itself. Written as a real function so it is syntax-checked here, then serialized into sw.js.
   Caches:
     le-app-<version>  everything in ASSETS, cache-first. A new version installs beside it and waits
                       until the person says "Update" or no open tab has work in progress.
     le-fonts-v1       font library files, cache-first, size-capped (LRU).
     le-assets-v1      graphics JSON (icon packs, collage layouts), stale-while-revalidate, size-capped (LRU).
     le-photos-v1      collage pool photos, cache-first, size-capped (LRU).
     le-models-v1      on-device AI: model files are stored by the feature that downloads them (with an
                       x-le-model header) and only served from here; the AI engine (assets/vendor/ort*)
                       is stored here on first use. Never precached, never trimmed automatically.
     le-share-v1       files shared to the app from the system share sheet until the studio picks them up. */
function swMain(VERSION, ASSETS, CRITICAL) {
  'use strict';
  var CACHE = 'le-app-' + VERSION;
  var RT = { fonts: 'le-fonts-v1', assets: 'le-assets-v1', photos: 'le-photos-v1', models: 'le-models-v1', share: 'le-share-v1' };
  var KEEP = [RT.fonts, RT.assets, RT.photos, RT.models, RT.share];
  var MB = 1024 * 1024;
  var caps = {};
  caps[RT.fonts] = 120 * MB;
  caps[RT.assets] = 600 * MB;
  caps[RT.photos] = 80 * MB;
  var puts = {};

  function post(msg) {
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      list.forEach(function (c) { c.postMessage(msg); });
    });
  }
  /* A redirected response cannot answer a navigation, so store a clean copy. */
  function plain(res) {
    if (!res.redirected) return Promise.resolve(res);
    return res.blob().then(function (b) { return new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }); });
  }
  /* One missing file must not break the install: six lanes, failures collected, only CRITICAL files are fatal. */
  function precache(name) {
    return caches.open(name).then(function (c) {
      var queue = ASSETS.slice();
      var failed = [];
      function lane() {
        var u = queue.shift();
        if (!u) return Promise.resolve();
        return fetch(new Request(u, { cache: 'reload', credentials: 'same-origin' })).then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          return plain(res).then(function (r) { return c.put(u, r); });
        }).catch(function () { failed.push(u); }).then(lane);
      }
      var lanes = [];
      for (var i = 0; i < 6; i++) lanes.push(lane());
      return Promise.all(lanes).then(function () { return { count: ASSETS.length - failed.length, failed: failed }; });
    });
  }

  self.addEventListener('install', function (e) {
    var first = !self.registration.active;
    e.waitUntil(precache(CACHE).then(function (r) {
      var bad = r.failed.filter(function (u) { return CRITICAL.indexOf(u) >= 0; });
      if (bad.length) throw new Error('Could not save ' + bad.join(', ') + ' for offline use');
      /* The very first install has nothing open to protect, so it may take over at once. */
      if (first) self.skipWaiting();
      return post({ type: 'le-installed', version: VERSION, first: first, count: r.count, failed: r.failed });
    }).catch(function (err) {
      return caches.delete(CACHE).then(function () { throw err; });
    }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE && KEEP.indexOf(k) < 0 && (k.indexOf('le-app-') === 0 || /^it-\d+$/.test(k));
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }).then(function () {
      return post({ type: 'le-activated', version: VERSION });
    }));
  });

  /* ---- Size-capped runtime caches. Cache.keys() is insertion order; a hit re-inserts the entry, so the
     front of the list is the least recently used. Entries carry x-le-bytes / x-le-at when this worker stored them. */
  function entrySize(res) {
    if (!res) return Promise.resolve(0);
    var n = Number(res.headers.get('x-le-bytes')) || Number(res.headers.get('content-length'));
    if (n) return Promise.resolve(n);
    return res.blob().then(function (b) { return b.size; }, function () { return 0; });
  }
  function stamp(res) {
    return res.blob().then(function (b) {
      var h = new Headers(res.headers);
      h.set('x-le-bytes', String(b.size));
      h.set('x-le-at', String(Date.now()));
      return new Response(b, { status: res.status, statusText: res.statusText, headers: h });
    });
  }
  function trim(name, cap) {
    if (!cap || KEEP.indexOf(name) < 0 || name === RT.models) return Promise.resolve({ removed: 0 });
    return caches.open(name).then(function (c) {
      return c.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return c.match(k).then(entrySize); })).then(function (sizes) {
          var total = sizes.reduce(function (a, b) { return a + b; }, 0);
          var jobs = [];
          for (var i = 0; i < keys.length && total > cap; i++) { total -= sizes[i]; jobs.push(c.delete(keys[i])); }
          return Promise.all(jobs).then(function () { return { removed: jobs.length }; });
        });
      });
    });
  }
  function store(e, name, req, res) {
    return caches.open(name).then(function (c) {
      return stamp(res).then(function (r) { return c.put(req, r); });
    }).then(function () {
      puts[name] = (puts[name] || 0) + 1;
      if (caps[name] && puts[name] % 10 === 1) return trim(name, caps[name]);
    });
  }
  function touch(e, name, req, hit) {
    var at = Number(hit.headers.get('x-le-at')) || 0;
    if (Date.now() - at < 6 * 3600 * 1000) return;
    var copy = hit.clone();
    e.waitUntil(caches.open(name).then(function (c) { return stamp(copy).then(function (r) { return c.put(req, r); }); }).catch(function () {}));
  }
  /* Runtime caches: cache-first (revalidate=false) or stale-while-revalidate (revalidate=true). */
  function runtime(e, name, revalidate, lru) {
    var req = e.request;
    return caches.open(name).then(function (c) { return c.match(req, { ignoreSearch: true }); }).then(function (hit) {
      if (hit && !revalidate) { if (lru) touch(e, name, req, hit); return hit; }
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          e.waitUntil((lru ? store(e, name, req, copy) : caches.open(name).then(function (c) { return c.put(req, copy); })).catch(function () {}));
        }
        return res;
      }).catch(function (err) { if (hit) return hit; throw err; });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net;
    });
  }

  /* App files: this version's cache first, so an open page never mixes old and new code. */
  function navKeys(url) {
    var p = url.pathname;
    var out = [url.origin + p];
    if (/\/index\.html$/.test(p)) out.push(url.origin + p.replace(/index\.html$/, ''));
    else if (!/\/$/.test(p) && !/\.[a-z0-9]+$/i.test(p)) out.push(url.origin + p + '/');
    return out;
  }
  function app(e, url) {
    var req = e.request;
    var nav = req.mode === 'navigate';
    return caches.open(CACHE).then(function (c) {
      var keys = nav ? navKeys(url) : [req];
      function next(i) {
        if (i >= keys.length) return Promise.resolve(null);
        return c.match(keys[i], { ignoreSearch: true }).then(function (r) { return r || next(i + 1); });
      }
      return next(0).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (!nav && res.status === 200 && res.type === 'basic' && url.pathname.indexOf('/assets/') >= 0) {
            var copy = res.clone();
            e.waitUntil(c.put(req, copy).catch(function () {}));
          }
          return res;
        }).catch(function (err) {
          if (!nav) throw err;
          return c.match('./offline.html').then(function (r) { return r || c.match('./'); }).then(function (r) { return r || Response.error(); });
        });
      });
    });
  }

  /* Android share sheet: POST multipart, park the files in le-share-v1, open the studio, which picks them up. */
  function receiveShare(e) {
    var studio = new URL('./studio/', self.location).href;
    return e.request.formData().then(function (form) {
      var files = form.getAll('media').filter(function (f) { return f && typeof f !== 'string'; }).slice(0, 20);
      var id = String(Date.now());
      return caches.open(RT.share).then(function (c) {
        return Promise.all(files.map(function (f, i) {
          var h = { 'content-type': f.type || 'application/octet-stream', 'x-le-name': encodeURIComponent(f.name || 'shared-' + i), 'x-le-at': id, 'x-le-bytes': String(f.size) };
          return c.put(new Request(new URL('./__share/' + id + '/' + i, self.location).href), new Response(f, { headers: h }));
        }));
      }).then(function () { return Response.redirect(studio + '?shared=' + id, 303); });
    }).catch(function () { return Response.redirect(studio + '?shared=failed', 303); });
  }

  self.addEventListener('fetch', function (e) {
    var req = e.request;
    var url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (req.method === 'POST' && /\/studio\/$/.test(url.pathname) && url.searchParams.has('share-target')) { e.respondWith(receiveShare(e)); return; }
    if (req.method !== 'GET' || req.headers.has('range')) return;
    var p = url.pathname;
    if (/\/sw\.js$/.test(p) || p.indexOf('/__share/') >= 0) return;
    if (p.indexOf('/assets/models/') >= 0) { e.respondWith(caches.open(RT.models).then(function (c) { return c.match(req, { ignoreSearch: true }); }).then(function (hit) { return hit || fetch(req); })); return; }
    if (p.indexOf('/assets/vendor/ort') >= 0) { e.respondWith(runtime(e, RT.models, false, false)); return; }
    if (p.indexOf('/assets/fonts/library/') >= 0) { e.respondWith(runtime(e, RT.fonts, false, true)); return; }
    if (/\/assets\/data\/[\w\/-]+\.json$/.test(p)) { e.respondWith(runtime(e, RT.assets, true, true)); return; }
    if (p.indexOf('/assets/photos/') >= 0) { e.respondWith(runtime(e, RT.photos, false, true)); return; }
    e.respondWith(app(e, url));
  });

  /* Pages talk to the worker through le-pwa.js. */
  function askBusy(client) {
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      var t = setTimeout(function () { resolve(true); }, 1500);
      ch.port1.onmessage = function (m) { clearTimeout(t); resolve(!!(m.data && m.data.busy)); };
      client.postMessage({ type: 'le-busy?' }, [ch.port2]);
    });
  }
  self.addEventListener('message', function (e) {
    var d = e.data || {};
    var port = e.ports && e.ports[0];
    function reply(v) { if (port) port.postMessage(v); }
    if (d.type === 'le-skip-waiting') { self.skipWaiting(); reply({ ok: true }); }
    else if (d.type === 'le-version') reply({ version: VERSION, cache: CACHE, files: ASSETS.length });
    else if (d.type === 'le-apply-if-idle') {
      e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        /* The tab that asked has already said it is idle (it may be leaving). */
        var me = e.source && e.source.id;
        return Promise.all(list.filter(function (c) { return c.id !== me; }).map(askBusy));
      }).then(function (busy) {
        var idle = !busy.some(Boolean);
        if (idle) self.skipWaiting();
        reply({ applied: idle });
      }));
    } else if (d.type === 'le-limits' && d.caps) {
      Object.keys(d.caps).forEach(function (k) { if (KEEP.indexOf(k) >= 0 && d.caps[k] > 0) caps[k] = d.caps[k]; });
      reply({ ok: true });
    } else if (d.type === 'le-trim') {
      e.waitUntil(trim(d.name, d.cap || caps[d.name]).then(reply, function () { reply({ removed: 0 }); }));
    } else if (d.type === 'le-precache') {
      e.waitUntil(precache(CACHE).then(function (r) { reply({ count: r.count, failed: r.failed }); }, function () { reply({ count: 0, failed: ASSETS }); }));
    }
  });
}

function swSource(opts = {}) {
  const version = opts.version || VERSION;
  const files = opts.files || precacheList();
  return `/* LocalEditor service worker, version ${version}. Generated by scripts/build.js; edit the generator, not this file. */\n` +
    `(${swMain.toString()})(${JSON.stringify(version)}, ${JSON.stringify(files)}, ${JSON.stringify(CRITICAL)});\n`;
}

function buildSW() {
  const files = precacheList();
  fs.writeFileSync(path.join(ROOT, 'sw.js'), swSource({ files }));
  return files.length;
}

module.exports = { ROOT, VERSION, ON_DEMAND, CRITICAL, manifestJSON, precacheList, swSource, TOOLS, CATS, I };

if (require.main === module) {
  buildIndex(); buildAbout(); buildOffline();
  PAGES.build(); buildMeta(); PAGES.build({ quiet: true }); // pages first (sitemap lists them), then their llms.txt section
  const n = buildSW();
  const missing = TOOLS.filter((t) => !fs.existsSync(path.join(ROOT, t.slug, 'index.html'))).map((t) => t.slug);
  const lost = CRITICAL.filter((u) => !precacheList().includes(u));
  if (lost.length) { console.error('Critical files missing from the precache: ' + lost.join(', ')); process.exitCode = 1; }
  console.log(`Built. ${TOOLS.length} tools listed, ${n} files precached (worker ${VERSION}).${missing.length ? ' MISSING: ' + missing.join(', ') : ' All tool pages present.'}`);
}
