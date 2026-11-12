const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const CAT_INFO = {
  image: {
    emoji: '📸',
    label: 'Image tool',
    unsplash: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=1200&q=80',
    floats: ['📸', '🎨', '✨', '🖼️'],
    drop: '📁 Drop images here or tap to choose'
  },
  pdf: {
    emoji: '📄',
    label: 'PDF tool',
    unsplash: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=1200&q=80',
    floats: ['📄', '📑', '⚡', '🔒'],
    drop: '📁 Drop PDF files here or tap to choose'
  },
  text: {
    emoji: '✍️',
    label: 'Text tool',
    unsplash: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80',
    floats: ['✍️', '📝', '✨', '💬'],
    drop: '📁 Drop text file here or tap to choose'
  },
  dev: {
    emoji: '⚡',
    label: 'Developer tool',
    unsplash: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
    floats: ['⚡', '🔮', '🚀', '💻'],
    drop: '📁 Drop file here or tap to choose'
  }
};

const TOOLS = [
  ['image', 'image-compressor'],
  ['image', 'image-resizer'],
  ['image', 'image-converter'],
  ['image', 'image-cropper'],
  ['image', 'rotate-flip-image'],
  ['image', 'watermark-image'],
  ['image', 'image-to-base64'],
  ['image', 'color-picker'],
  ['image', 'favicon-generator'],
  ['image', 'image-filters'],
  ['pdf', 'merge-pdf'],
  ['pdf', 'split-pdf'],
  ['pdf', 'jpg-to-pdf'],
  ['pdf', 'pdf-to-jpg'],
  ['pdf', 'rotate-pdf'],
  ['pdf', 'organize-pdf'],
  ['pdf', 'add-page-numbers'],
  ['pdf', 'watermark-pdf'],
  ['text', 'word-counter'],
  ['text', 'case-converter'],
  ['text', 'text-diff'],
  ['text', 'lorem-ipsum-generator'],
  ['dev', 'qr-code-generator'],
  ['dev', 'password-generator'],
  ['dev', 'json-formatter'],
  ['dev', 'base64-encoder'],
  ['dev', 'hash-generator'],
  ['dev', 'unit-converter'],
  ['dev', 'color-converter'],
  ['dev', 'uuid-generator'],
];

console.log('Retired. The LocalEditor design system is assets/css/app.css. This script no longer edits pages.');
process.exit(0);

let updatedCount = 0;

for (const [cat, slug] of TOOLS) {
  const filePath = path.join(ROOT, slug, 'index.html');
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    continue;
  }

  let html = fs.readFileSync(filePath, 'utf8');
  const info = CAT_INFO[cat];

  // 1. Ensure withicons is in <head>
  if (!html.includes('withicons/classes')) {
    html = html.replace(
      '<link rel="stylesheet" href="../assets/css/app.css">',
      '<link rel="stylesheet" href="../assets/css/app.css">\n<script src="https://cdn.jsdelivr.net/npm/@withicons/classes@latest/dist/with-loader.js" defer></script>\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@withicons/motion@latest/dist/motion.css">'
    );
  }

  // 2. Update theme color
  html = html.replace('<meta name="theme-color" content="#5b5bf7">', '<meta name="theme-color" content="#FF5E62">');

  // 3. Update install app button
  html = html.replace('<button class="btn btn-sm install-btn" type="button">Install app</button>', '<button class="btn btn-sm install-btn" type="button">✨ Install app</button>');

  // 4. Update eyebrow
  // Pattern: <span class="eyebrow">...</span>
  html = html.replace(/<span class="eyebrow">(?:📸|📄|✍️|⚡)?\s*([^<]+)<\/span>/i, (m, txt) => {
    return `<span class="eyebrow">${info.emoji} ${txt.trim()}</span>`;
  });

  // 5. Enhance trust badges
  html = html.replace(/>100% free<\/span>/g, '>🆓 100% free</span>');
  html = html.replace(/>No upload — runs on your device<\/span>/g, '>🔒 No upload — runs on your device</span>');
  html = html.replace(/>Works offline<\/span>/g, '>📴 Works offline</span>');

  // 6. Add ambient Unsplash background & floating icons to hero if not already present
  if (!html.includes('hero-ambient-img')) {
    const ambientHtml = `\n    <div class="hero-ambient-img" style="background-image:url('${info.unsplash}');" aria-hidden="true"></div>\n    <span class="hero-float-icon hero-float-1" aria-hidden="true">${info.floats[0]}</span>\n    <span class="hero-float-icon hero-float-2" aria-hidden="true">${info.floats[1]}</span>\n    <span class="hero-float-icon hero-float-3" aria-hidden="true">${info.floats[2]}</span>\n    <span class="hero-float-icon hero-float-4" aria-hidden="true">${info.floats[3]}</span>\n    `;
    html = html.replace(/(<section class="hero[^"]*">)/, `$1${ambientHtml}`);
  }

  // 7. Update dropzone text if dropzone exists
  if (html.includes('<div class="dropzone"')) {
    html = html.replace(/<strong>Drop ([^<]+)<\/strong>/i, (m, inner) => {
      if (inner.startsWith('📁')) return m;
      return `<strong>📁 Drop ${inner}</strong>`;
    });
  }

  // 8. Content headings
  html = html.replace(/<h2>How to /g, '<h2>📋 How to ');
  html = html.replace(/<h2>What is /g, '<h2>💡 What is ');
  html = html.replace(/<h2>Frequently asked questions<\/h2>/g, '<h2>💡 Frequently asked questions</h2>');
  html = html.replace(/<h2>Related tools<\/h2>/g, '<h2>🔗 Related tools</h2>');

  // 9. Footer
  html = html.replace(
    /<span>© (?:20\d\d )?Instant Tools · Free, private browser tools that work offline\.<\/span>/g,
    '<span>© 2026 Instant Tools · Made with ❤️ · Free, private browser tools that work offline.</span>'
  );

  fs.writeFileSync(filePath, html, 'utf8');
  updatedCount++;
}

console.log(`Successfully upgraded ${updatedCount} tool pages with world-class design!`);

