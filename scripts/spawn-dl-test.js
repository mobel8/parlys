#!/usr/bin/env node
/** Detached spawn of run-double-launch-test.js; logs to scripts/_dl.log. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '_dl.log');
const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');

const runs = process.argv[2] || '1';

const child = spawn(process.execPath, [path.join(__dirname, 'run-double-launch-test.js'), runs], {
  cwd: path.join(__dirname, '..'),
  detached: true,
  stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();

fs.writeFileSync(path.join(__dirname, '_dl.pid'), String(child.pid));
console.log('spawned double-launch test pid=' + child.pid + ' runs=' + runs + ' log=' + logPath);
