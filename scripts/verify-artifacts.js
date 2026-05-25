#!/usr/bin/env node
/**
 * Verify that every expected artifact for the current platform is
 * present in `release/`, weighs in at a sensible size, and that
 * its internal structure is valid (where cheap to check).
 *
 * Exit code 0 = all good, 1 = something is wrong.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RELEASE_DIR = path.join(__dirname, '..', 'release');
const MIN_SIZE_MB = 40;   // Electron + deps weighs at least this much.
const MAX_SIZE_MB = 400;  // Anything larger is almost certainly junk.

const OS = process.platform; // 'win32' | 'linux' | 'darwin'

function log(msg) {
  process.stdout.write(msg + '\n');
}
function fail(msg) {
  process.stderr.write(`[verify] FAIL: ${msg}\n`);
  process.exitCode = 1;
}

if (!fs.existsSync(RELEASE_DIR)) {
  fail(`release/ directory is missing — did the build run?`);
  process.exit(1);
}

const all = fs.readdirSync(RELEASE_DIR);
const expected = {
  win32:  [/^VoiceInk-Setup-.*\.exe$/],
  linux:  [/\.AppImage$/, /\.deb$/],
  darwin: [/\.dmg$/],
}[OS] || [];

const optional = {
  win32:  [],
  linux:  [/\.rpm$/, /\.tar\.gz$/],
  darwin: [/\.zip$/],
}[OS] || [];

log(`[verify] platform=${OS}  scanning ${RELEASE_DIR}`);
log(`[verify] files found: ${all.length}`);

const matches = (file, patterns) => patterns.some(re => re.test(file));

let ok = true;
const results = [];

for (const pattern of expected) {
  const match = all.find(f => pattern.test(f));
  if (!match) {
    fail(`missing required artifact matching ${pattern}`);
    ok = false;
    continue;
  }
  const full = path.join(RELEASE_DIR, match);
  const st = fs.statSync(full);
  const sizeMb = st.size / (1024 * 1024);
  const sizeStr = sizeMb.toFixed(1) + ' MB';
  let status = 'ok';
  if (sizeMb < MIN_SIZE_MB) { status = `too small (< ${MIN_SIZE_MB} MB)`; fail(`${match}: ${status}`); ok = false; }
  if (sizeMb > MAX_SIZE_MB) { status = `too large (> ${MAX_SIZE_MB} MB)`; fail(`${match}: ${status}`); ok = false; }
  results.push({ file: match, size: sizeStr, status });
}

for (const pattern of optional) {
  const match = all.find(f => pattern.test(f));
  if (!match) continue;
  const full = path.join(RELEASE_DIR, match);
  const st = fs.statSync(full);
  const sizeMb = st.size / (1024 * 1024);
  results.push({ file: match, size: sizeMb.toFixed(1) + ' MB', status: 'ok (optional)' });
}

// Windows-specific: try to peek inside the NSIS installer. The magic
// header starts with 'MZ' (PE executable) — basic sanity check.
if (OS === 'win32') {
  const exe = all.find(f => /^VoiceInk-Setup-.*\.exe$/.test(f));
  if (exe) {
    const fd = fs.openSync(path.join(RELEASE_DIR, exe), 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    if (buf.toString('latin1') !== 'MZ') {
      fail(`${exe}: missing PE 'MZ' header — not a valid Windows executable`);
      ok = false;
    }
  }
}

// Linux-specific: AppImage starts with the ELF header 7F 45 4C 46.
if (OS === 'linux') {
  const appImg = all.find(f => /\.AppImage$/.test(f));
  if (appImg) {
    const fd = fs.openSync(path.join(RELEASE_DIR, appImg), 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0x7F || buf[1] !== 0x45 || buf[2] !== 0x4C || buf[3] !== 0x46) {
      fail(`${appImg}: missing ELF magic — not a valid AppImage`);
      ok = false;
    }
  }

  const deb = all.find(f => /\.deb$/.test(f));
  if (deb) {
    try {
      const header = execSync(`dpkg-deb -I "${path.join(RELEASE_DIR, deb)}"`, { stdio: ['ignore', 'pipe', 'ignore'] });
      if (!header.toString().includes('Package: voiceink')) {
        fail(`${deb}: dpkg-deb info doesn't mention Package: voiceink`);
        ok = false;
      }
    } catch (e) {
      // dpkg-deb not available → skip.
    }
  }
}

// macOS-specific: DMG starts with the koly trailer at EOF — sanity-check file size.
if (OS === 'darwin') {
  const dmg = all.find(f => /\.dmg$/.test(f));
  if (dmg) {
    try {
      execSync(`hdiutil imageinfo "${path.join(RELEASE_DIR, dmg)}"`, { stdio: 'ignore' });
    } catch (e) {
      fail(`${dmg}: hdiutil imageinfo failed — DMG is corrupt`);
      ok = false;
    }
  }
}

// Print a clean summary table.
log('');
log('[verify] artifacts:');
for (const r of results) {
  const pad = r.file.padEnd(46);
  log(`  ${pad}  ${r.size.padStart(10)}  [${r.status}]`);
}
log('');
if (ok) {
  log('[verify] ✅ all expected artifacts present and valid.');
  process.exit(0);
} else {
  log('[verify] ❌ verification failed.');
  process.exit(1);
}
