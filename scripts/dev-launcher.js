// Parlys dev launcher — orchestrates a fully-live development session.
//
// What it does:
//   1. Starts Vite dev server (renderer HMR @ http://localhost:5173).
//   2. Starts tsc -p tsconfig.main.json --watch (main process incremental).
//   3. Once dist/main/index.js exists, spawns Electron with
//      VITE_DEV_SERVER_URL set, so main/index.ts' `isDev` branch loads
//      the renderer from the Vite dev URL instead of the bundled file.
//      Renderer source edits → Vite HMR pushes them in-place, no relaunch.
//   4. Watches dist/main/ — when tsc emits new JS for the main process,
//      kills + respawns Electron after a 300 ms debounce. Main edits →
//      app restarts automatically with the new code.
//
// Why this is the answer to "0 modifications when I click the desktop
// shortcut": the original shortcut targeted the *installed* Parlys.exe
// at C:\Users\…\AppData\Local\Programs\Parlys\Parlys.exe — a frozen
// snapshot from electron-builder. By repointing the shortcut at this
// launcher (via dev.bat), every click runs against live source.
//
// Lifecycle: closing the Electron window also tears down Vite + tsc.
// Ctrl-C in the launcher's console terminates everything.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const ELECTRON_BIN = IS_WIN
  ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(ROOT, 'node_modules', '.bin', 'electron');
const MAIN_ENTRY = path.join(ROOT, 'dist', 'main', 'index.js');
const MAIN_DIST_DIR = path.join(ROOT, 'dist', 'main');
const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;

function ts() { return new Date().toISOString().slice(11, 19); }
function log(tag, msg) { process.stdout.write(`[${ts()}] [${tag}] ${msg}\n`); }
function pipe(tag, child) {
  child.stdout?.on('data', (b) => process.stdout.write(`[${tag}] ${b}`));
  child.stderr?.on('data', (b) => process.stderr.write(`[${tag}] ${b}`));
}

// --- Children -------------------------------------------------------------

let viteProc = null;
let tscProc = null;
let electronProc = null;
let restartTimer = null;
let shuttingDown = false;
// True between the moment WE call electronProc.kill() and the next
// successful spawnElectron(). Lets the on-exit handler distinguish a
// kill we initiated (= an expected restart, keep the launcher alive)
// from a user-initiated quit (= tear down). Necessary because Windows
// translates `kill('SIGTERM')` into TerminateProcess(), which Node
// surfaces as `code=1, signal=null` — indistinguishable from a real
// crash without explicit bookkeeping.
let expectingExit = false;

// Spawn a child via the local node_modules/.bin entry — bypassing
// `npx`/`npx.cmd` entirely. This avoids the Node 18+ Windows
// `spawn EINVAL` regression triggered when child_process.spawn is
// asked to launch a .cmd shim without `shell: true`. Using the
// platform-specific binary path is also faster (no npx resolution
// per launch) and gives us a known absolute path we can sanity-check.
function localBin(name) {
  return IS_WIN
    ? path.join(ROOT, 'node_modules', '.bin', `${name}.cmd`)
    : path.join(ROOT, 'node_modules', '.bin', name);
}

// Spawn a child process for a local-bin tool.
//
// On Windows we cannot pass args alongside shell:true to spawn() any
// more — Node 18.20+ emits DEP0190 because the arguments would be
// concatenated without escaping. Instead we go through cmd.exe
// directly and quote each argument ourselves with the Windows quoting
// rule (wrap in `"..."`, double any `"` inside, escape trailing `\`).
//
// On Linux/Mac the .bin shim is a real executable, so spawn() works
// without any shell at all.
function quoteWin(arg) {
  if (arg === '' || /[\s"]/.test(arg) === false) return arg;
  // Per Microsoft cmd.exe quoting: escape inner quotes, then wrap.
  return '"' + arg.replace(/"/g, '\\"') + '"';
}

function spawnTool(label, binPath, args) {
  if (!fs.existsSync(binPath)) {
    log(label, `binary not found at ${binPath} — run "npm install" first`);
    shutdown(1);
    return null;
  }
  let child;
  if (IS_WIN) {
    // Build the full command string and hand it off to cmd.exe /d /s /c.
    // /d disables AutoRun, /s with /c "...double-quotes..." preserves
    // the entire command verbatim (cmd's documented escape hatch for
    // exotic quoting). This avoids DEP0190 entirely because we don't
    // pass args to spawn — only a single executable + a small flag set.
    const cmdLine = [binPath, ...args].map(quoteWin).join(' ');
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
      windowsHide: false,
      // windowsVerbatimArguments lets cmd.exe see our pre-quoted args
      // exactly as we built them, instead of Node re-quoting on top.
      windowsVerbatimArguments: true,
    });
  } else {
    child = spawn(binPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });
  }
  pipe(label, child);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(label, `exited code=${code} signal=${signal} — shutting down launcher`);
      shutdown(1);
    }
  });
  return child;
}

function startVite() {
  log('vite', 'starting Vite dev server…');
  viteProc = spawnTool('vite', localBin('vite'), [
    '--host', '127.0.0.1',
    '--port', String(VITE_PORT),
    '--strictPort',
  ]);
}

function startTsc() {
  log('tsc', 'starting tsc --watch for main process…');
  tscProc = spawnTool('tsc', localBin('tsc'), [
    '-p', 'tsconfig.main.json',
    '--watch',
    '--preserveWatchOutput',
  ]);
}

function spawnElectron() {
  if (electronProc) return; // already running
  if (!fs.existsSync(ELECTRON_BIN)) {
    log('electron', `binary not found at ${ELECTRON_BIN}`);
    shutdown(1);
    return;
  }
  log('electron', 'launching app…');
  expectingExit = false;
  electronProc = spawn(ELECTRON_BIN, [MAIN_ENTRY], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: VITE_URL,
      // Stripping ELECTRON_RUN_AS_NODE / ELECTRON_NO_ATTACH_CONSOLE so
      // electron.exe boots as a real Electron runtime even if a parent
      // shell leaked one of those flags into our env (a problem the
      // smoke-test scripts already documented).
      ELECTRON_RUN_AS_NODE: undefined,
      ELECTRON_NO_ATTACH_CONSOLE: undefined,
    },
  });
  pipe('electron', electronProc);
  electronProc.on('exit', (code, signal) => {
    log('electron', `exited code=${code} signal=${signal}`);
    const weKilledIt = expectingExit;
    electronProc = null;
    // Three exit cases:
    //   (a) we called kill() to restart (expectingExit=true)        → keep launcher alive
    //   (b) a fresh restart is queued (restartTimer pending)        → keep launcher alive
    //   (c) genuine user quit (close window or app.quit())          → tear down launcher
    if (shuttingDown) return;
    if (weKilledIt || restartTimer) {
      // Restart loop will respawn — nothing to do here.
      return;
    }
    shutdown(0);
  });
}

function restartElectron(reason) {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (electronProc) {
      log('electron', `restart (${reason})`);
      // Mark the impending exit as expected BEFORE issuing the kill,
      // so the exit handler (which fires synchronously on Windows
      // TerminateProcess) sees the flag set.
      expectingExit = true;
      try { electronProc.kill('SIGTERM'); } catch { /* ignore */ }
      // Wait for old process to actually exit before respawning, otherwise
      // the new one races the single-instance lock and loses, then exits
      // immediately as a duplicate.
      const wait = setInterval(() => {
        if (!electronProc) {
          clearInterval(wait);
          spawnElectron(); // resets expectingExit = false
        }
      }, 80);
    } else {
      spawnElectron();
    }
  }, 300);
}

// Wait for tsc's first complete compile, then boot Electron once and
// watch the dir for *real* incremental rebuilds (= subsequent emits
// triggered by source edits).
//
// Why we wait for the "first compile complete" signal instead of just
// polling for index.js: tsc --watch emits every .js file during its
// initial build (often 30+ files for a non-trivial project), and our
// fs.watch sees each emit as a "main rebuilt" event. Booting Electron
// before that compile finishes would trigger a redundant
// kill+respawn cycle on the very first launch — the user would see
// the app flash open then close then re-open. Detecting "Found 0
// errors. Watching for file changes." in tsc's stdout marks the moment
// emits go quiet.
function watchMainBuild() {
  fs.mkdirSync(MAIN_DIST_DIR, { recursive: true });

  let firstCompileDone = false;
  // Listen on the tsc proc's stdout for the watch-mode quiescence
  // marker. tsc prints either "Found 0 errors." (success) or
  // "Found N errors." (failure, but watch keeps running and we still
  // want to boot — main might be partially valid for a quick test).
  // The exact message is locale-dependent in pre-5.0 tsc; we match
  // the broader pattern "Watching for file changes." which is stable.
  const onTscOut = (b) => {
    const s = b.toString();
    if (!firstCompileDone && /Watching for file changes/.test(s)) {
      firstCompileDone = true;
      log('launcher', 'first compile complete — booting Electron');
      if (fs.existsSync(MAIN_ENTRY)) spawnElectron();
      else log('launcher', 'WARNING: tsc says compile finished but ' + MAIN_ENTRY + ' missing');
    }
  };
  const attachTscListener = () => {
    if (tscProc?.stdout) tscProc.stdout.on('data', onTscOut);
    else setTimeout(attachTscListener, 100);
  };
  attachTscListener();

  // Belt-and-braces fallback: if we never see the marker after 60 s
  // (different tsc version, locale, …) but index.js does exist, boot
  // anyway so the user isn't stuck staring at a console.
  setTimeout(() => {
    if (!firstCompileDone && fs.existsSync(MAIN_ENTRY)) {
      log('launcher', 'tsc marker timed out, booting Electron from existing dist/');
      firstCompileDone = true;
      spawnElectron();
    }
  }, 60_000);

  // fs.watch with `recursive: true` on Windows works on a folder.
  // restartElectron's 300 ms debounce coalesces a multi-file emit into
  // a single restart. We gate on firstCompileDone so initial emits
  // don't bounce Electron before it's even up.
  try {
    fs.watch(MAIN_DIST_DIR, { recursive: true }, (event, filename) => {
      if (!firstCompileDone) return;
      if (!filename || !filename.toString().endsWith('.js')) return;
      restartElectron(`main rebuilt: ${filename}`);
    });
  } catch (e) {
    log('launcher', `fs.watch failed: ${e.message} — falling back to polling`);
    let lastMtime = fs.existsSync(MAIN_ENTRY) ? fs.statSync(MAIN_ENTRY).mtimeMs : 0;
    setInterval(() => {
      if (!firstCompileDone) return;
      try {
        const m = fs.statSync(MAIN_ENTRY).mtimeMs;
        if (m !== lastMtime) { lastMtime = m; restartElectron('main rebuilt (poll)'); }
      } catch { /* ignore */ }
    }, 700);
  }
}

// --- Shutdown -------------------------------------------------------------

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('launcher', 'shutting down…');
  for (const p of [electronProc, tscProc, viteProc]) {
    if (!p) continue;
    try { p.kill('SIGTERM'); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => { log('launcher', `uncaught: ${e.stack || e}`); shutdown(1); });

// --- Pre-flight: refuse to start if another launcher is already up -------

// If 5173 is bound, an existing dev launcher is almost certainly already
// serving the renderer. Spawning a second Vite would fail (--strictPort)
// and our chained shutdown would tear down everything noisily. Detect
// the collision early, surface a friendly message, and exit cleanly so
// the user's `dev.bat` doesn't pop up its `Press any key to close…`
// crash banner. This also covers the "user double-clicks the desktop
// shortcut" case.
function checkExistingInstance() {
  return new Promise((resolve) => {
    const net = require('net');
    const probe = net.connect({ host: '127.0.0.1', port: VITE_PORT }, () => {
      probe.destroy();
      resolve(true);
    });
    probe.on('error', () => resolve(false));
    setTimeout(() => { try { probe.destroy(); } catch {} resolve(false); }, 600);
  });
}

(async function main() {
  log('launcher', `ROOT=${ROOT}`);
  log('launcher', `Vite URL = ${VITE_URL}`);
  log('launcher', `Electron = ${ELECTRON_BIN}`);

  if (await checkExistingInstance()) {
    log('launcher', `port ${VITE_PORT} already in use — another Parlys dev launcher is already running.`);
    log('launcher', 'doing nothing — focus the existing app window or close it before launching again.');
    // Exit 0 so dev.bat does NOT show "Press any key to close" (that's
    // reserved for genuine launcher failures the user should see).
    process.exit(0);
  }

  startVite();
  startTsc();
  watchMainBuild();
  log('launcher', 'ready — edit src/ and watch the app rebuild + restart automatically');
})();
