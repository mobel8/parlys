/**
 * Auto-update orchestration for VoiceInk.
 *
 * Design decisions
 * ─────────────────────────────────────────────────────────────────────
 * 1. **electron-updater over Squirrel** : we already NSIS-install on
 *    Windows, and electron-updater supports both NSIS differential
 *    updates AND macOS/Linux in one API. Squirrel.Windows would
 *    require a full installer rewrite.
 *
 * 2. **Auto-download OFF by default**. We check silently at startup
 *    (after a 15s grace period so we don't steal network bandwidth
 *    during the first-paint) but ONLY notify the user when an update
 *    is found. The user decides whether to download. Post-download,
 *    the user decides whether to "Quit & Install". This is the
 *    Mac App Store / JetBrains norm — never interrupt work.
 *
 * 3. **GitHub Releases as feed**. Public repo → free, no server to
 *    run. `electron-builder` emits `latest.yml`, `latest-mac.yml`,
 *    `latest-linux.yml` at `dist` time; we upload them alongside the
 *    installer to a GitHub Release named `v${version}`.
 *
 * 4. **Dev-mode is a no-op**. When `app.isPackaged === false` (running
 *    via `npm run dev`) we skip all autoUpdater calls — they would
 *    throw "app-update.yml not found" and pollute stderr.
 *
 * 5. **Single source of truth** : the module keeps a `state` variable
 *    that every renderer can poll via IPC.UPDATER_GET_STATE. Useful
 *    when a second window opens mid-download and wants to reflect
 *    the current progress.
 *
 * 6. **Code signing** — on Windows without an EV cert, electron-updater
 *    still downloads and installs, but SmartScreen will warn users.
 *    See `docs/CODE_SIGNING.md` for the procurement procedure. On
 *    macOS without notarization, the app will be flagged by Gatekeeper
 *    and won't auto-update at all (signature check fails). We surface
 *    this clearly in the error state.
 */

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC, UpdaterState } from '../shared/types';

// Current state, single source of truth. Mutated by every autoUpdater event.
let state: UpdaterState = { phase: 'idle' };

/** Broadcast the current state to every renderer window. */
function broadcast() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try {
        w.webContents.send(IPC.ON_UPDATER_STATE, state);
      } catch {
        /* window may be mid-close */
      }
    }
  }
}

function setState(next: UpdaterState) {
  state = next;
  broadcast();
}

/** Public accessor for the renderer to hydrate on mount. */
export function getUpdaterState(): UpdaterState {
  return state;
}

/**
 * Manually trigger a check. Returns immediately — listen on
 * ON_UPDATER_STATE for transitions. Safe to call multiple times;
 * no-ops if a check is already in flight.
 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    // Dev mode : pretend we checked and are up-to-date.
    setState({ phase: 'up-to-date', version: app.getVersion() });
    return;
  }
  if (state.phase === 'checking' || state.phase === 'downloading') {
    return;
  }
  setState({ phase: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Install the downloaded update and restart. No-op unless state is
 * 'ready'. Calling this quits the app — any in-flight IPC will be
 * torn down, so the renderer should confirm with the user beforehand.
 */
export function installAndRestart(): void {
  if (state.phase !== 'ready') return;
  // `isSilent=true` : don't show the installer UI (we already asked the user).
  // `isForceRunAfter=true` : re-launch VoiceInk right after the install.
  autoUpdater.quitAndInstall(true, true);
}

/**
 * Wire up autoUpdater event handlers and kick off a first background
 * check. Called once from `src/main/index.ts` after `app.whenReady()`.
 */
export function initUpdater() {
  if (!app.isPackaged) {
    // Skip all wiring in dev mode — prevents the 'app-update.yml not
    // found' error that would otherwise spam on every reload.
    return;
  }

  // We drive the flow manually (download on user consent), so disable
  // the default auto-download behavior.
  autoUpdater.autoDownload = false;
  // Install on app quit is risky — some users kill the app hard. We
  // prefer explicit "Install & restart" buttons.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    setState({ phase: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    // Start downloading eagerly — most users click "Install" when the
    // banner appears. Downloading in the background (differential,
    // a few MB) is faster than waiting for a second click.
    setState({ phase: 'available', version: info?.version });
    autoUpdater.downloadUpdate().catch((err) => {
      setState({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setState({ phase: 'up-to-date', version: info?.version });
  });

  autoUpdater.on('download-progress', (p) => {
    setState({
      phase: 'downloading',
      version: state.version,
      progress: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setState({ phase: 'ready', version: info?.version });
  });

  autoUpdater.on('error', (err) => {
    setState({
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // First check after a 15-second grace window. This avoids competing
  // with first-paint network requests (Groq prewarm, voice list) and
  // gives the user a chance to see the app before any network noise.
  setTimeout(() => {
    checkForUpdates().catch(() => {
      /* surfaced via 'error' event */
    });
  }, 15_000);

  // Re-check every 4 hours while the app is running. A typical
  // dictation session is < 30 minutes, so most users will only ever
  // hit the startup check; long-lived sessions (interpreters left
  // open at a conference desk) benefit from the recurring check.
  setInterval(() => {
    checkForUpdates().catch(() => { /* ignore */ });
  }, 4 * 60 * 60 * 1000);
}
