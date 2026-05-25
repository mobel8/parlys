#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '_live.log');
const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');

const args = [path.join(__dirname, 'live-console.js'), ...process.argv.slice(2)];
const child = spawn(process.execPath, args, {
  cwd: path.join(__dirname, '..'),
  detached: true, stdio: ['ignore', out, err],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
child.unref();
fs.writeFileSync(path.join(__dirname, '_live.pid'), String(child.pid));
console.log('spawned live-console pid=' + child.pid + ' args=' + process.argv.slice(2).join(' '));
