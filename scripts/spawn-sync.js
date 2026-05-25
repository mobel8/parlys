#!/usr/bin/env node
/** Detached build + sync-install; logs to scripts/_sync.log. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '_sync.log');
const out = fs.openSync(logPath, 'w');
const err = fs.openSync(logPath, 'a');

const child = spawn('cmd.exe', ['/c', path.join(__dirname, 'build-and-sync.bat')], {
  cwd: path.join(__dirname, '..'),
  detached: true,
  stdio: ['ignore', out, err],
});
child.unref();

fs.writeFileSync(path.join(__dirname, '_sync.pid'), String(child.pid));
console.log('spawned build-and-sync pid=' + child.pid + ' logging to ' + logPath);
