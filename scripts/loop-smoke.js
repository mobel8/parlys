// Loop smoke — runs the Electron app with each view (main / history /
// settings) in sequence, captures main stdout + renderer console logs
// forwarded by `webContents.on('console-message')`, and classifies
// every line into: error / warning / info. Re-runs the whole loop N
// times (default 2) so warm-cache bugs show up too.
//
// Usage:
//   node scripts/loop-smoke.js          # default 2 passes, 10s each
//   node scripts/loop-smoke.js 3 8000   # 3 passes, 8s per view
//
// Set LOOP_SMOKE_VERBOSE=1 to dump raw child stdout/stderr in real time.
//
// Exit codes:
//   0 — no fatal errors found across all runs
//   1 — at least one fatal pattern matched in renderer or main output
//   2 — Electron exited early in at least one run (crash during boot)

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const PASSES = Number(process.argv[2]) || 2;
const TIMEOUT_MS = Number(process.argv[3]) || 10000;
const VIEWS = ['main', 'history', 'settings'];

const FATAL_PATTERNS = [
  { label: 'ReferenceError',   re: /ReferenceError/i },
  { label: 'UncaughtTypeError', re: /Uncaught TypeError/i },
  { label: 'NotDefined',       re: /Uncaught .* is not defined/i },
  { label: 'SyntaxError',      re: /SyntaxError/i },
  { label: 'UnhandledRejection', re: /Unhandled (Promise )?rejection/i },
  { label: 'ElectronCrash',    re: /FATAL:.*electron|child_process exited with code/i },
];
const WARNING_PATTERNS = [
  { label: 'CSPViolation',       re: /Content[- ]Security[- ]Policy/i },
  { label: 'DevtoolsWarn',       re: /DevTools failed|autofill/i },
  { label: 'RegisterRefused',    re: /registration refused/i },
  { label: 'LoadRendererFailed', re: /loadRenderer failed/i },
];

const root = path.join(__dirname, '..');
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainEntry = 'dist\\main\\index.js';

function killExisting() {
  // Packaged app (installer) spawns VoiceInk.exe; dev spawn uses electron.exe.
  // Either will hold the single-instance lock, so we nuke both.
  try { spawnSync('taskkill', ['/F', '/IM', 'electron.exe', '/T'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  try { spawnSync('taskkill', ['/F', '/IM', 'VoiceInk.exe', '/T'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
  // Give Windows a breath to release the single-instance lock.
  try { spawnSync(process.execPath, ['-e', 'setTimeout(function(){}, 1500)'], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}

function runOne(view) {
  return new Promise(function (resolve) {
    killExisting();
    const cleanEnv = Object.assign({}, process.env);
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;
    cleanEnv.VOICEINK_START_VIEW = view;

    const started = Date.now();
    const child = spawn(electronBin, [mainEntry], {
      cwd: root,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });

    const issues = [];
    let windowSeen = false;
    const onChunk = function (tag) {
      return function (chunk) {
        const s = chunk.toString('utf8');
        if (process.env.LOOP_SMOKE_VERBOSE) {
          process.stdout.write('[' + view + ':' + tag + '] ' + s);
        }
        const lines = s.split('\n');
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          if (/koffi loaded|native foreground tracker|\[renderer /.test(line)) windowSeen = true;
          for (const p of FATAL_PATTERNS) {
            if (p.re.test(line)) issues.push({ level: 'FATAL', label: p.label, line: line });
          }
          for (const p of WARNING_PATTERNS) {
            if (p.re.test(line)) issues.push({ level: 'WARN', label: p.label, line: line });
          }
        }
      };
    };
    child.stdout.on('data', onChunk('out'));
    child.stderr.on('data', onChunk('err'));

    const timer = setTimeout(function () {
      try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
      setTimeout(function () { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }, 2000);
    }, TIMEOUT_MS);

    child.on('exit', function (code, signal) {
      clearTimeout(timer);
      const killedByUs = signal === 'SIGTERM' || (code === null && signal === null);
      const durationMs = Date.now() - started;
      const earlyExit = !killedByUs && !windowSeen;
      resolve({ view: view, issues: issues, earlyExit: earlyExit, durationMs: durationMs, windowSeen: windowSeen });
    });
  });
}

(async function main() {
  console.log('');
  console.log('[loop-smoke] ' + PASSES + ' passes × ' + VIEWS.length + ' views × ' + TIMEOUT_MS + ' ms/view');
  console.log('[loop-smoke] total upper bound: ' + (PASSES * VIEWS.length * TIMEOUT_MS) / 1000 + ' s');
  console.log('');

  const allResults = [];
  for (let p = 1; p <= PASSES; p++) {
    for (const view of VIEWS) {
      process.stdout.write('[loop-smoke] pass ' + p + '/' + PASSES + ' · view=' + view + ' … ');
      const res = await runOne(view);
      const fatals = res.issues.filter(function (i) { return i.level === 'FATAL'; }).length;
      const warns  = res.issues.filter(function (i) { return i.level === 'WARN';  }).length;
      const status =
        res.earlyExit ? 'EARLY-EXIT' :
        fatals > 0    ? 'FATAL(' + fatals + ')' :
        warns > 0     ? 'warn(' + warns + ')' :
                        'ok';
      console.log(status + '  [' + res.durationMs + ' ms, window=' + (res.windowSeen ? 'up' : 'no') + ']');
      allResults.push(res);
    }
  }

  // === Aggregate report =================================================
  console.log('');
  console.log('[loop-smoke] ═══ aggregate report ═══');
  const fatalMap = new Map();
  const warnMap  = new Map();
  let earlyExitCount = 0;
  for (const r of allResults) {
    if (r.earlyExit) earlyExitCount++;
    for (const i of r.issues) {
      const map = i.level === 'FATAL' ? fatalMap : warnMap;
      const key = i.label + ' [' + r.view + ']';
      if (!map.has(key)) map.set(key, { count: 0, sample: i.line });
      map.get(key).count++;
    }
  }

  if (fatalMap.size === 0 && warnMap.size === 0 && earlyExitCount === 0) {
    console.log('[loop-smoke] ✓ no fatals, no warnings, no early exits.');
    process.exit(0);
  }
  if (earlyExitCount > 0) {
    console.log('[loop-smoke] ! ' + earlyExitCount + ' early exits');
  }
  if (fatalMap.size > 0) {
    console.log('[loop-smoke] FATALS:');
    for (const [k, v] of fatalMap) {
      console.log('  × ' + k + ' — ' + v.count + '×  sample: ' + v.sample.slice(0, 140));
    }
  }
  if (warnMap.size > 0) {
    console.log('[loop-smoke] warnings:');
    for (const [k, v] of warnMap) {
      console.log('  · ' + k + ' — ' + v.count + '×  sample: ' + v.sample.slice(0, 140));
    }
  }

  if (fatalMap.size > 0) process.exit(1);
  if (earlyExitCount > 0) process.exit(2);
  process.exit(0);
})();
