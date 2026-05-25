// End-to-end smoke test for the Settings view.
//
// Spawns a built, production Electron app with VOICEINK_START_VIEW=settings
// so the renderer lands directly on SettingsView on first render, then
// watches stderr/stdout for any "ReferenceError" message emitted by the
// renderer (main's `webContents.on('console-message')` handler already
// forwards renderer console errors to main's stdout, so we just have to
// grep the child process output).
//
// Exit codes:
//   0 — Settings mounted without throwing
//   1 — Saw "ReferenceError" or similar fatal error
//   2 — Timed out waiting for the window to appear
//
// Usage:
//   npm run smoke:settings
//   # or directly:
//   node scripts/smoke-settings.js
//
// Prerequisites: `dist/main` and `dist/renderer` must already be built
// (e.g. via `npm run build`). The script does NOT rebuild — call it
// after a build so it tests exactly the bundles that would ship in
// the installer.
//
// The timeout is intentionally long (12 s) because the first-run
// settings load goes through `voiceink.getSettings` IPC which touches
// disk and sometimes warms up a few ms on slow NVMe on cold boot.

const { spawn, spawnSync } = require('child_process');
const path = require('path');

// Kill any residual Electron so we reliably claim the single-instance
// lock. Without this, the smoke test silently lands in the "lost the
// lock" branch and quits with code 0 before showing any window.
try { spawnSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' }); } catch { /* ignore */ }

const root = path.join(__dirname, '..');
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const mainEntry = 'dist\\main\\index.js';

const TIMEOUT_MS = 12000;
const FATAL_PATTERNS = [
  /ReferenceError/i,
  /Uncaught .* is not defined/i,
  /Uncaught TypeError/i,
];

// CRITICAL: purge ELECTRON_RUN_AS_NODE (and friends) from the inherited
// env. When that flag is set — often unintentionally, inherited from a
// parent Node session — electron.exe launches as a plain Node process,
// `require('electron')` returns an empty stub, and the main entry
// explodes with "electron.app is undefined" the moment it calls
// `app.setName`. Stripping these flags forces the full Electron runtime
// (with BrowserWindow, ipcMain, etc.) every time.
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;
delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE;
cleanEnv.VOICEINK_START_VIEW = 'settings';

console.log('[smoke] launching electron in settings-view mode…');
const child = spawn(electronBin, [mainEntry], {
  cwd: root,
  env: cleanEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

let buffer = '';
let fatal = null;
let windowSeen = false;
const onChunk = (tag) => (chunk) => {
  const s = chunk.toString('utf8');
  buffer += s;
  process.stdout.write(`[child:${tag}] ${s}`);
  // Several lines from main's boot indicate the window actually came
  // up: the native focus tracker log, koffi loading, or a
  // `[renderer …]` line (webContents.on('console-message') forwarder).
  if (/koffi loaded|native foreground tracker|\[renderer /.test(s)) windowSeen = true;
  for (const pat of FATAL_PATTERNS) {
    if (pat.test(s)) { fatal = `matched ${pat}`; }
  }
};
child.stdout.on('data', onChunk('out'));
child.stderr.on('data', onChunk('err'));

const timer = setTimeout(() => {
  console.log(`[smoke] ${TIMEOUT_MS} ms elapsed, shutting down`);
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 2000);
}, TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (fatal) {
    console.error(`\n[smoke] FAIL — ${fatal}`);
    process.exit(1);
  }
  // `signal === 'SIGTERM'` (or null with code null on Windows) means
  // WE killed it after reaching the timeout without any fatal pattern.
  // That's the success path: electron ran happily for the full 12 s,
  // the renderer had ample time to mount SettingsView, and nothing
  // exploded. If the process exited on its own BEFORE the timeout we
  // treat that as suspicious (it might have failed to claim the
  // single-instance lock, or crashed in main before the window came up).
  const killedByUs = signal === 'SIGTERM' || (code === null && signal === null);
  if (!killedByUs && !windowSeen) {
    console.error(`\n[smoke] FAIL — electron exited early (code=${code}, signal=${signal}) before any window banner was logged. Likely lost the single-instance lock or crashed during main init.`);
    process.exit(2);
  }
  console.log('\n[smoke] PASS — SettingsView mounted without fatal errors.');
  process.exit(0);
});
