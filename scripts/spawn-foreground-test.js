#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '_foreground.log');
const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');

const child = spawn(process.execPath, [path.join(__dirname, 'run-foreground-preservation-test.js')], {
  cwd: path.join(__dirname, '..'),
  detached: true, stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();
fs.writeFileSync(path.join(__dirname, '_foreground.pid'), String(child.pid));
console.log('spawned foreground-preservation test pid=' + child.pid);
