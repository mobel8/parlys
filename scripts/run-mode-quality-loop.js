/**
 * Run run-mode-quality-test.js 3 times, aggregate pass/fail. LLM
 * outputs are non-deterministic; a single green run could be luck, a
 * single red run could be a transient rate-limit. Three in a row is a
 * reasonable bar for "prompts are stable enough to ship".
 *
 * Exit code 0 iff all 3 iterations passed. Output is concatenated so
 * the user can scroll back and see each run's per-check verdict.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ITERATIONS = 3;
const script = path.join(__dirname, 'run-mode-quality-test.js');

let passes = 0;
for (let i = 1; i <= ITERATIONS; i++) {
  console.log(`\n================== ITERATION ${i}/${ITERATIONS} ==================`);
  const res = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (res.status === 0) passes++;
  console.log(`-- iteration ${i} exit code: ${res.status}`);
}

console.log(`\n================== LOOP SUMMARY ==================`);
console.log(`${passes} / ${ITERATIONS} iterations passed`);
process.exit(passes === ITERATIONS ? 0 : 1);
