#!/usr/bin/env node
/** Detached regression batch: hover + double-launch + exercise. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '_regression.log');
const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');

const wrapperPath = path.join(__dirname, 'run-regression-suite.js');
fs.writeFileSync(wrapperPath, `
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const steps = [
  { name: 'hover (1 run)',       script: 'run-installed-hover-test.js',   args: ['1'] },
  { name: 'double-launch (1)',   script: 'run-double-launch-test.js',     args: ['1'] },
  { name: 'exercise',            script: 'run-exercise-test.js',          args: [] },
];
let totalFails = 0;
for (const s of steps) {
  console.log('\\n>>>>>>>>>>>>> ' + s.name + ' >>>>>>>>>>>>>');
  const r = spawnSync(process.execPath, [path.join(__dirname, s.script), ...s.args], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (r.status !== 0) totalFails++;
}
console.log('\\n=== REGRESSION SUITE ' + (totalFails === 0 ? 'PASSED' : 'FAILED ' + totalFails) + ' ===');
process.exit(totalFails);
`);

const child = spawn(process.execPath, [wrapperPath], {
  cwd: path.join(__dirname, '..'),
  detached: true, stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();
fs.writeFileSync(path.join(__dirname, '_regression.pid'), String(child.pid));
console.log('spawned regression-suite pid=' + child.pid);
