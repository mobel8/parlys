const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const N = parseInt(process.argv[2] || '3', 10);
const wrapper = path.join(__dirname, 'run-foreground-loop.js');
fs.writeFileSync(wrapper, `
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
let fails = 0;
for (let i = 1; i <= ${N}; i++) {
  console.log('\\n=============== RUN ' + i + ' / ${N} ===============');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'run-foreground-preservation-test.js')], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (r.status !== 0) fails++;
}
console.log('\\n===========================================');
console.log(fails === 0 ? '  \\u2705 ' + ${N} + '/' + ${N} + ' PASS' : '  \\u274c ' + fails + ' fail(s) out of ${N}');
console.log('===========================================');
process.exit(fails);
`);
const out = fs.openSync(path.join(__dirname, '_foreground_loop.log'), 'w');
const err = fs.openSync(path.join(__dirname, '_foreground_loop.log'), 'a');
const child = spawn(process.execPath, [wrapper], {
  cwd: path.join(__dirname, '..'),
  detached: true, stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();
console.log('spawned foreground-loop pid=' + child.pid + ' N=' + N);
