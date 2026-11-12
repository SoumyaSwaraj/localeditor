/* Runs every tests/*.test.js. Usage: node tests/run.js [name-filter] */
'use strict';
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

(async () => {
  const filter = process.argv[2] || '';
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f.indexOf(filter) >= 0).sort();
  const { server, base } = await h.serve();
  const browser = await h.chromium.launch();
  let pass = 0, fail = 0;
  for (const f of files) {
    const cases = require(path.join(__dirname, f));
    for (const name of Object.keys(cases)) {
      const t0 = Date.now();
      try {
        await Promise.race([
          cases[name]({ browser, base, h }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out after 90s')), 90000))
        ]);
        pass++;
        console.log('  ok   ' + f.replace('.test.js', '') + ' › ' + name + ' (' + (Date.now() - t0) + 'ms)');
      } catch (err) {
        fail++;
        console.log('  FAIL ' + f.replace('.test.js', '') + ' › ' + name + '\n       ' + String(err.message).split('\n')[0]);
      }
      for (const c of browser.contexts()) await c.close().catch(() => {});
    }
  }
  await browser.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
