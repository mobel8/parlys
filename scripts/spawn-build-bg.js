#!/usr/bin/env node
/**
 * Fire-and-forget spawn of build-loop.js so Cascade doesn't block
 * on the long-running electron-builder invocation. The child
 * writes to scripts/_build.log and we return immediately.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '_build.log');
const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');

const args = ['scripts/build-loop.js', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, {
  cwd: path.join(__dirname, '..'),
  detached: true,
  stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();

fs.writeFileSync(path.join(__dirname, '_build.pid'), String(child.pid));
console.log('spawned build pid=' + child.pid + ' logging to ' + logPath);
