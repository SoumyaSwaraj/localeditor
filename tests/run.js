/* Runs every tests/*.test.js. Usage: node tests/run.js [name-filter]
 *
 * Conventions (additive):
 *  - A case whose name starts with "KNOWN-BUG:" is run and reported as "known" when it fails; it does not fail the run.
 *    If it starts passing, the runner says so (remove the prefix then). Use it for confirmed product bugs filed in docs/QA-REPORT.md.
 *  - TEST_JOBS=N runs N test files in parallel, each in its own browser (default 1: strictly serial, as before).
 *  - TEST_CASE=text runs only cases whose name contains the text.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

const KNOWN = 'KNOWN-BUG:';
const CASE_TIMEOUT = Number(process.env.TEST_TIMEOUT || 90000);

async function runFile(browser, base, f, only) {
  const out = { lines: [], pass: 0, known: 0, fail: 0, fixed: [] };
  const label = f.replace('.test.js', '');
  let cases;
  try { cases = require(path.join(__dirname, f)); } catch (err) {
    out.fail++; out.lines.push('  FAIL ' + label + ' › (file failed to load)\n       ' + String(err.message).split('\n')[0]); return out;
  }
  for (const name of Object.keys(cases)) {
    if (only && name.indexOf(only) < 0) continue;
    const t0 = Date.now();
    const known = name.indexOf(KNOWN) === 0;
    let timer;
    try {
      await Promise.race([
        cases[name]({ browser, base, h }),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Timed out after ' + Math.round(CASE_TIMEOUT / 1000) + 's')), CASE_TIMEOUT); })
      ]);
      out.pass++;
      if (known) out.fixed.push(label + ' › ' + name);
      out.lines.push('  ok   ' + label + ' › ' + name + ' (' + (Date.now() - t0) + 'ms)' + (known ? '   <- known bug now passes: remove the KNOWN-BUG prefix' : ''));
    } catch (err) {
      const msg = String(err.message).split('\n')[0];
      if (known) { out.known++; out.lines.push('  known ' + label + ' › ' + name + '\n       ' + msg); }
      else { out.fail++; out.lines.push('  FAIL ' + label + ' › ' + name + '\n       ' + msg); }
    } finally { clearTimeout(timer); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
  return out;
}

(async () => {
  const t0 = Date.now();
  const filter = process.argv[2] || '';
  const only = process.env.TEST_CASE || '';
  const jobs = Math.max(1, Number(process.env.TEST_JOBS || 1));
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f.indexOf(filter) >= 0).sort();
  const { server, base } = await h.serve();
  const total = { pass: 0, known: 0, fail: 0, fixed: [] };
  const add = (r) => { r.lines.forEach((l) => console.log(l)); total.pass += r.pass; total.known += r.known; total.fail += r.fail; total.fixed = total.fixed.concat(r.fixed); };
  if (jobs === 1) {
    const browser = await h.chromium.launch();
    for (const f of files) add(await runFile(browser, base, f, only));
    await browser.close();
  } else {
    const queue = files.slice();
    await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, async () => {
      const browser = await h.chromium.launch();
      while (queue.length) add(await runFile(browser, base, queue.shift(), only));
      await browser.close();
    }));
  }
  server.close();
  console.log('\n' + total.pass + ' passed, ' + total.known + ' known, ' + total.fail + ' failed  (' + Math.round((Date.now() - t0) / 1000) + 's)');
  if (total.fixed.length) console.log('Known bugs that now pass: ' + total.fixed.join('; '));
  process.exit(total.fail ? 1 : 0);
})();
