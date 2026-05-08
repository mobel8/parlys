#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const asar = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk', 'resources', 'app.asar');
const idx  = path.join(__dirname, '..', 'dist', 'main', 'index.js');

for (const p of [asar, idx]) {
  if (!fs.existsSync(p)) { console.log('MISSING:', p); continue; }
  const s = fs.statSync(p);
  console.log(p);
  console.log('  size :', (s.size / 1e6).toFixed(2), 'MB');
  console.log('  mtime:', s.mtime.toISOString());
}
