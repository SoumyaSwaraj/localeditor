'use strict';
/* Finds a Chromium-family browser: --browser / LE_BROWSER, then Chrome, Edge, Chromium and Brave in the standard
   places on macOS, Windows and Linux, then a Playwright or Puppeteer download in its cache. */
const fs = require('fs');
const os = require('os');
const path = require('path');

function isExe(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch (e) { return false; }
}

function onPath(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const n of names) for (const d of dirs) for (const e of exts) { const p = path.join(d, n + e); if (isExe(p)) return p; }
  return null;
}

function standardCandidates() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const apps = [
      ['Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
      ['Chromium', 'Chromium.app/Contents/MacOS/Chromium'],
      ['Microsoft Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      ['Brave', 'Brave Browser.app/Contents/MacOS/Brave Browser'],
      ['Google Chrome Canary', 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary']
    ];
    const out = [];
    for (const [name, rel] of apps) { out.push({ name, path: path.join('/Applications', rel) }); out.push({ name, path: path.join(home, 'Applications', rel) }); }
    return out;
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const rels = [
      ['Google Chrome', 'Google\\Chrome\\Application\\chrome.exe'],
      ['Microsoft Edge', 'Microsoft\\Edge\\Application\\msedge.exe'],
      ['Chromium', 'Chromium\\Application\\chrome.exe'],
      ['Brave', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe']
    ];
    const out = [];
    for (const [name, rel] of rels) for (const r of roots) out.push({ name, path: path.join(r, rel) });
    return out;
  }
  const fixed = [
    ['Google Chrome', '/usr/bin/google-chrome'], ['Google Chrome', '/usr/bin/google-chrome-stable'], ['Google Chrome', '/opt/google/chrome/chrome'],
    ['Chromium', '/usr/bin/chromium'], ['Chromium', '/usr/bin/chromium-browser'], ['Chromium', '/snap/bin/chromium'],
    ['Microsoft Edge', '/usr/bin/microsoft-edge'], ['Microsoft Edge', '/usr/bin/microsoft-edge-stable'], ['Microsoft Edge', '/opt/microsoft/msedge/msedge'],
    ['Brave', '/usr/bin/brave-browser'], ['Brave', '/usr/bin/brave'], ['Brave', '/opt/brave.com/brave/brave']
  ].map(([name, p]) => ({ name, path: p }));
  const named = onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']);
  if (named) fixed.push({ name: path.basename(named), path: named });
  return fixed;
}

/* Playwright (~/.cache/ms-playwright, PLAYWRIGHT_BROWSERS_PATH) and Puppeteer (~/.cache/puppeteer) downloads. */
function cachedCandidates() {
  const home = os.homedir();
  const out = [];
  const pwRoots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(home, '.cache', 'ms-playwright'), path.join(home, 'Library', 'Caches', 'ms-playwright'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null].filter((x) => x && x !== '0');
  const rels = process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-x64/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32' ? ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe'] : ['chrome-linux/chrome', 'chrome-linux64/chrome'];
  for (const r of pwRoots) {
    let dirs = [];
    try { dirs = fs.readdirSync(r).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); } catch (e) { continue; }
    for (const d of dirs) for (const rel of rels) out.push({ name: 'Playwright Chromium', path: path.join(r, d, rel) });
  }
  const pp = path.join(home, '.cache', 'puppeteer', 'chrome');
  try {
    for (const d of fs.readdirSync(pp).sort().reverse()) {
      const base = path.join(pp, d);
      for (const sub of fs.readdirSync(base)) {
        const p = process.platform === 'darwin'
          ? path.join(base, sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
          : path.join(base, sub, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
        out.push({ name: 'Puppeteer Chrome for Testing', path: p });
      }
    }
  } catch (e) { /* none */ }
  return out;
}

const HINTS = {
  darwin: 'Install Google Chrome (https://www.google.com/chrome/) or run: brew install --cask chromium',
  win32: 'Install Google Chrome or Microsoft Edge (Edge ships with Windows 10 and 11).',
  linux: 'Install Chromium (sudo apt install chromium, or sudo dnf install chromium) or Google Chrome, or run: npx playwright install chromium'
};

/* Returns { path, name, source } or throws an Error with code 'no-browser' and install hints. */
function findBrowser(explicit) {
  const given = explicit || process.env.LE_BROWSER;
  if (given) {
    if (isExe(given)) return { path: given, name: path.basename(given), source: explicit ? '--browser' : 'LE_BROWSER' };
    const err = new Error('The browser at ' + given + ' does not exist or cannot be run.');
    err.code = 'no-browser';
    throw err;
  }
  for (const c of standardCandidates()) if (isExe(c.path)) return { path: c.path, name: c.name, source: 'installed' };
  for (const c of cachedCandidates()) if (isExe(c.path)) return { path: c.path, name: c.name, source: 'cache' };
  const err = new Error('No Chrome, Edge, Chromium or Brave was found.\n' + (HINTS[process.platform] || HINTS.linux) +
    '\nOr point at one: localeditor --browser /path/to/chrome …  (or set LE_BROWSER).');
  err.code = 'no-browser';
  throw err;
}

module.exports = { findBrowser, standardCandidates, cachedCandidates };
