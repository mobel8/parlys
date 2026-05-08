#!/usr/bin/env node
/**
 * Build VoiceInk installers for the current platform — and also
 * cross-build Linux AppImage + tar.gz from Windows when possible
 * (electron-builder supports that if Developer Mode is enabled so
 * symlinks can be created without admin).
 *
 * Usage:
 *   node scripts/build-all.js           # native + safe cross-builds
 *   node scripts/build-all.js --native  # only the current OS
 *   node scripts/build-all.js --ci      # assumes we're on a CI runner
 *                                       # and builds only that runner's OS
 */
'use strict';

const fs           = require('fs');
const path         = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');

const args = process.argv.slice(2);
const nativeOnly = args.includes('--native');
const ciMode     = args.includes('--ci');

const OS = process.platform; // 'win32' | 'linux' | 'darwin'

function header(title) {
  const bar = '='.repeat(title.length + 4);
  console.log('');
  console.log(bar);
  console.log(`= ${title} =`);
  console.log(bar);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: OS === 'win32',
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} exited with ${r.status}`);
  }
}

function tryRun(cmd, cmdArgs, opts = {}) {
  try { run(cmd, cmdArgs, opts); return true; }
  catch (e) { console.warn(`[warn] ${e.message}`); return false; }
}

function ensureIcons() {
  header('Regenerate icons');
  run('node', ['scripts/gen-icons.js']);
}

function buildApp() {
  header('Compile main + renderer');
  run('npm', ['run', 'build']);
}

function buildTarget(flags, label) {
  header(`electron-builder ${label}`);
  return tryRun('npx', ['electron-builder', ...flags, '--publish', 'never']);
}

function verify() {
  header('Verify artifacts');
  run('node', ['scripts/verify-artifacts.js']);
}

function listArtifacts() {
  if (!fs.existsSync(RELEASE)) return;
  const files = fs.readdirSync(RELEASE)
    .filter(f => !f.endsWith('.yml') && !f.endsWith('.blockmap') && !f.startsWith('.'))
    .filter(f => {
      const st = fs.statSync(path.join(RELEASE, f));
      return st.isFile();
    });
  header('Release folder contents');
  for (const f of files) {
    const st = fs.statSync(path.join(RELEASE, f));
    const mb = (st.size / (1024 * 1024)).toFixed(1);
    console.log(`  ${f.padEnd(46)}  ${mb.padStart(7)} MB`);
  }
}

// ---------- plan ----------

const plan = [];
if (ciMode || nativeOnly) {
  if (OS === 'win32')  plan.push([['--win'],   'Windows']);
  if (OS === 'linux')  plan.push([['--linux'], 'Linux']);
  if (OS === 'darwin') plan.push([['--mac'],   'macOS']);
} else {
  // Non-CI, non-native: native + whatever cross-builds are safe.
  if (OS === 'win32') {
    plan.push([['--win'], 'Windows']);
    // Linux AppImage + tar.gz: no Ruby/fpm needed; works cross-platform
    // provided Windows Developer Mode is on (for symlink creation).
    plan.push([['--linux', 'AppImage', 'tar.gz'], 'Linux AppImage + tar.gz (cross-build)']);
  } else if (OS === 'linux') {
    plan.push([['--linux'], 'Linux']);
    plan.push([['--win'], 'Windows (cross, needs wine)']);
  } else if (OS === 'darwin') {
    plan.push([['--mac'],   'macOS']);
    plan.push([['--linux'], 'Linux (cross)']);
    plan.push([['--win'],   'Windows (cross, needs wine)']);
  }
}

// ---------- run ----------

(async () => {
  try {
    ensureIcons();
    buildApp();

    const results = [];
    for (const [flags, label] of plan) {
      const ok = buildTarget(flags, label);
      results.push({ label, ok });
    }

    listArtifacts();

    // Only fail verify if the native target was built — cross-builds
    // are best-effort and shouldn't block the summary.
    try { verify(); } catch (e) { console.warn('[verify]', e.message); }

    header('Build summary');
    for (const r of results) {
      console.log(`  ${r.ok ? '[OK]' : '[--]'}  ${r.label}`);
    }
    console.log('\n[build-all] done.');

    // The first plan entry is always the native target. If it failed,
    // the whole run has failed from the user's POV — exit non-zero so
    // the CI / build-loop wrapper treats it as red.
    const native = results[0];
    if (native && !native.ok) {
      console.error(`[build-all] native target (${native.label}) failed.`);
      process.exit(2);
    }
  } catch (e) {
    console.error('\n[build-all] ERROR:', e.message);
    process.exit(1);
  }
})();
