#!/usr/bin/env node
/**
 * Build + verify in a loop. Optionally runs the installed-hover
 * regression test after each Windows build so we catch both
 * build-level and runtime regressions in the same pass.
 *
 * Usage:
 *   node scripts/build-loop.js              # 3 passes, native + cross
 *   node scripts/build-loop.js --runs=5     # 5 passes
 *   node scripts/build-loop.js --no-hover   # skip the installed-hover test
 *   node scripts/build-loop.js --native     # only native target (skip cross)
 */
'use strict';

const fs           = require('fs');
const path         = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const runsArg = args.find(a => a.startsWith('--runs='));
const RUNS = runsArg ? parseInt(runsArg.split('=')[1], 10) : 3;
const SKIP_HOVER = args.includes('--no-hover');
const NATIVE_ONLY = args.includes('--native');

const OS = process.platform;

function header(title) {
  console.log('\n' + '='.repeat(title.length + 4));
  console.log(`= ${title} =`);
  console.log('='.repeat(title.length + 4));
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: OS === 'win32',
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 10 * 60 * 1000,
  });
  return r.status === 0;
}

const results = [];

for (let i = 1; i <= RUNS; i++) {
  header(`Build+verify run ${i}/${RUNS}`);
  const startedAt = Date.now();

  const buildArgs = NATIVE_ONLY ? ['scripts/build-all.js', '--native'] : ['scripts/build-all.js'];
  const buildOk = run('node', buildArgs);
  if (!buildOk) {
    results.push({ run: i, build: false, verify: false, hover: null, ms: Date.now() - startedAt });
    console.error(`[run ${i}] build failed — stopping`);
    break;
  }

  const verifyOk = run('node', ['scripts/verify-artifacts.js']);

  let hoverOk = null;
  if (!SKIP_HOVER && OS === 'win32') {
    header(`Sync-install + hover regression (run ${i})`);
    const syncOk = run('node', ['scripts/sync-install.js']);
    if (syncOk) {
      hoverOk = run('node', ['scripts/run-installed-hover-test.js']);
    } else {
      console.warn('[hover] sync-install failed, skipping hover test this run');
      hoverOk = false;
    }
  }

  results.push({
    run: i,
    build: buildOk,
    verify: verifyOk,
    hover: hoverOk,
    ms: Date.now() - startedAt,
  });
}

header(`Build-loop summary (${results.length}/${RUNS} runs)`);
for (const r of results) {
  const sec = (r.ms / 1000).toFixed(1);
  const b = r.build  ? '[OK]' : '[KO]';
  const v = r.verify ? '[OK]' : '[KO]';
  const h = r.hover === null ? '[--]' : r.hover ? '[OK]' : '[KO]';
  console.log(`  run ${r.run}  build=${b}  verify=${v}  hover=${h}   ${sec}s`);
}

const allGreen = results.length === RUNS &&
  results.every(r => r.build && r.verify && (r.hover === null || r.hover === true));

console.log('');
if (allGreen) {
  console.log(`=== ALL ${RUNS} RUN(S) PASSED ===`);
  process.exit(0);
} else {
  console.error('=== BUILD-LOOP FAILED ===');
  process.exit(1);
}
