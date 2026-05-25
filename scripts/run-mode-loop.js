/**
 * Run the mode test 3× and tally pass/fail. Each run calls Groq 4 times
 * (raw short-circuits before the HTTP call, the other 3 each make a real
 * chat completion). Occasional single failures due to network jitter are
 * acceptable if the majority pass; but ALL 3 runs should pass cleanly
 * for the fix to be considered shipped.
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const N = parseInt(process.argv[2] || '3', 10);
let fails = 0;
for (let i = 1; i <= N; i++) {
  console.log('\n=============== MODE TEST ' + i + ' / ' + N + ' ===============');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-mode-test.js')], {
    stdio: 'inherit',
  });
  if (r.status !== 0) fails++;
}
console.log('\n===========================================');
if (fails === 0) console.log('  \u2705 ' + N + '/' + N + ' PASS');
else console.log('  \u274c ' + fails + ' fail(s) out of ' + N);
console.log('===========================================');
process.exit(fails);
