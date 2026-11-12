#!/usr/bin/env node
'use strict';
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write('localeditor needs Node 20 or later (this is ' + process.version + ').\n');
  process.exit(3);
}
require('../lib/cli').main(process.argv.slice(2)).then((code) => {
  if (typeof code === 'number') process.exitCode = code;
  /* Long-running commands (serve, link, mcp) return null and keep the process alive. */
  /* Exit once stdout has drained (a pipe would otherwise lose the end of a large --json answer). */
  if (code !== null) process.stdout.write('', () => process.exit(process.exitCode || 0));
}, (e) => {
  process.stderr.write('Error: ' + (e && e.stack || e) + '\n');
  process.exit(3);
});
