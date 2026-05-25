#!/usr/bin/env node
/** Run the exercise test N times (default 3) sequentially, log aggregate. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const N = parseInt(process.argv[2] || '3', 10);
const logPath = path.join(__dirname, '_exercise_loop.log');
const wrapper = path.join(__dirname, 'run-exercise-loop.js');

fs.writeFileSync(wrapper, `
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
let fails = 0;
for (let i = 1; i <= ${N}; i++) {
  console.log('\\n=============== RUN ' + i + ' / ${N} ===============');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-exercise-test.js')], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (r.status !== 0) fails++;
}
console.log('\\n========================================');
console.log('  EXERCISE LOOP ' + (fails === 0 ? '\\u2705 ' + ${N} + '/' + ${N} + ' PASS' : '\\u274c ' + fails + ' fail'));
console.log('========================================');
process.exit(fails);
`);

const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');
const child = spawn(process.execPath, [wrapper], {
  cwd: path.join(__dirname, '..'),
  detached: true, stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();
fs.writeFileSync(path.join(__dirname, '_exercise_loop.pid'), String(child.pid));
console.log('spawned exercise-loop pid=' + child.pid + ' runs=' + N);
