import { app, BrowserWindow, ipcMain, Menu, powerMonitor, screen, shell } from 'electron';
import { join } from 'path';
import { existsSync, cpSync, renameSync } from 'fs';
import { IPC, Density } from '../shared/types';
import { registerIpc } from './ipc';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { createTray } from './tray';
import {
  initFocusTracking,
  stopFocusTracking,
  registerOwnWindow,
  unregisterOwnWindow,
} from './services/focus';
import { getSettings, setSettings } from './services/config';
import { initUpdater } from './updater';
import { getTheme, DEFAULT_EFFECTS } from '../shared/themes';

// Force the app name BEFORE any userData-dependent API runs. Without this,
// running the dev binary (node_modules/.bin/electron) uses the generic
// 'Electron' name → userData lands in %APPDATA%\Electron\ and creates a
// parallel settings file, orphaned from what the packaged .exe reads.
// Must stay the first executable statement of this module.
// One-time rebrand migration (VoiceInk → Parlys): if the new Parlys userData
// directory does not exist yet but the legacy 'voiceink' one does, copy it over
// (settings, history.json, dictionary…) and rename the settings file, so existing
// users keep their API keys, history and preferences across the rename.
// Best-effort: any failure falls through to fresh defaults rather than crashing.
const _appData = app.getPath('appData');
const _newDir = join(_appData, 'parlys');
const _oldDir = join(_appData, 'voiceink');
try {
  if (!existsSync(_newDir) && existsSync(_oldDir)) {
    cpSync(_oldDir, _newDir, { recursive: true });
    const _oldSettings = join(_newDir, 'voiceink-settings.json');
    const _newSettings = join(_newDir, 'parlys-settings.json');
    if (existsSync(_oldSettings) && !existsSync(_newSettings)) {
      renameSync(_oldSettings, _newSettings);
    }
    console.log('[migration] copied legacy VoiceInk userData → Parlys');
  }
} catch (err) {
  console.warn('[migration] VoiceInk → Parlys userData migration failed:', err);
}

app.setName('parlys');
// Test/diagnostic escape hatch: PARLYS_USERDATA points the WHOLE app state
// (settings, history, single-instance lock) at an isolated directory, so a
// harness instance can boot NEXT TO the user's running app without stealing
// its lock or polluting its data. Unset in normal use.
const _userDataOverride = (process.env.PARLYS_USERDATA || '').trim();
app.setPath('userData', _userDataOverride || _newDir);

// Single-instance lock. Without this, double-clicking the desktop
// shortcut spawns a second Electron process that:
//   - shows its own (duplicate) pill floating near the first one,
//   - registers its own tray icon,
//   - tries to grab the global shortcut — which fails silently because
//     the first instance already holds it, so pressing the hotkey only
//     toggles the first instance's recorder and nothing visually
//     changes on the second instance's pill (which is the one the user
//     is usually looking at, since it opened last and therefore sits
//     on top).
//
// `requestSingleInstanceLock` atomically claims ownership per userData
// dir. Non-primary processes get back `false`, forward their CLI args
// to the primary via the 'second-instance' event, and quit immediately.
// The primary surfaces its window so a repeated shortcut click always
// "focuses Parlys" instead of opening a duplicate.
const _gotLock = app.requestSingleInstanceLock();
if (!_gotLock) {
  app.quit();
  // Hard-exit so the rest of this module never runs: ipc registration,
  // tray creation, shortcut registration etc. all happen at import time
  // further down, and we must not execute any of it in a losing process.
  process.exit(0);
}

// Register the second-instance handler BEFORE whenReady. A fast
// double-click on the desktop shortcut can race: the second process
// spawns, loses the lock, emits this event, and quits — all within
// a few hundred ms, potentially before the primary's whenReady block
// has run. Attaching the listener at module import time closes that
// window. We use a getter-style accessor for getWin() because the
// variable isn't defined yet at this point in file order (hoisted
// via function declaration / closure below).
app.on('second-instance', () => {
  try {
    const w = getWinSafe();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.showInactive();
    // Don't steal keyboard focus — the pill is designed to float
    // silently above the user's work. For the comfortable window we
    // DO focus since the user explicitly relaunched the app.
    if (getSettings().density === 'comfortable') w.focus();
  } catch (e) {
    console.warn('[second-instance]', e);
  }
});

// Forward accessor so the event listener above works even though
// getWin() is declared later in file order. getWin() itself uses the
// `current` module-level variable, which is `null` until createWindow
// runs — the listener handles that gracefully by returning early.
function getWinSafe(): BrowserWindow | null {
  try { return getWin(); } catch { return null; }
}

/**
 * Wraps an Electron BrowserWindow with the density it was built for and
 * per-instance state we want to clean up deterministically (e.g. the pill
 * move-debounce timer, a `disposed` flag so stale callbacks no-op).
 *
 * We keep a single `current` reference so the rest of the codebase can
 * always obtain "the" main window via `getWin()`, but during a density
 * swap we can legitimately have two contexts alive for a handful of
 * frames — the old one being torn down, the new one being shown.
 */
interface WindowCtx {
  win: BrowserWindow;
  density: Density;
  pillMoveTimer: NodeJS.Timeout | null;
  disposed: boolean;
}

let current: WindowCtx | null = null;
/** Serialises density swaps so overlapping clicks can't race each other. */
let swapInFlight: Promise<void> | null = null;

const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

// Comfortable (main) window defaults.
const COMFORTABLE = { w: 1180, h: 760, minW: 880, minH: 560 };

// Compact pill widget — small floating badge (Superwhisper-style).
// 176x52 is the stock size at pillScale=1.0; user-configurable in Settings.
const WIDGET_BASE = { w: 176, h: 52 };

// Compute actual pill bounds from the user's pillScale. Reading the
// setting lazily (not at module load) means a SET_SETTINGS change can
// take effect on the next createWindow / buildWindow call without
// requiring an app restart.
function pillDimensions(): { w: number; h: number; scale: number } {
  const s = getSettings();
  const raw = (s as any).pillScale;
  const scale = typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(0.5, Math.min(1.5, raw))
    : 1.0;
  return {
    w: Math.round(WIDGET_BASE.w * scale),
    h: Math.round(WIDGET_BASE.h * scale),
    scale,
  };
}

// Back-compat alias: legacy code that reads WIDGET.w / WIDGET.h still
// resolves through the Proxy getter and picks up the scaled values.
const WIDGET = new Proxy(WIDGET_BASE, {
  get(_t, prop: string) {
    const d = pillDimensions();
    if (prop === 'w') return d.w;
    if (prop === 'h') return d.h;
    if (prop === 'scale') return d.scale;
    return (WIDGET_BASE as any)[prop];
  },
}) as { w: number; h: number; scale: number };

function getWin(): BrowserWindow | null {
  return current && !current.win.isDestroyed() ? current.win : null;
}

/**
 * Compute the default pill position: centered horizontally, near the top of
 * the primary display (matches Superwhisper's placement). Used on first
 * launch when no `widgetBounds` has been persisted yet.
 */
function defaultPillPosition(): { x: number; y: number } {
  try {
    const primary = screen.getPrimaryDisplay();
    const { x, y, width } = primary.workArea;
    return { x: x + Math.round((width - WIDGET.w) / 2), y: y + 24 };
  } catch {
    return { x: 100, y: 40 };
  }
}

/**
 * Clamp the pill position inside the union of all displays' work areas so
 * we never spawn it off-screen (e.g. after the user unplugged a monitor).
 */
function clampToDisplays(x: number, y: number): { x: number; y: number } {
  try {
    const displays = screen.getAllDisplays();
    const onScreen = displays.some((d) => {
      const a = d.workArea;
      return x >= a.x - 40 && y >= a.y - 40 && x + WIDGET.w <= a.x + a.width + 40 && y + WIDGET.h <= a.y + a.height + 40;
    });
    if (onScreen) return { x, y };
  } catch {}
  return defaultPillPosition();
}

/**
 * Build a hidden BrowserWindow wired for the given density. No renderer
 * content is loaded here — the caller chooses between `loadRenderer()` and
 * immediate `show()` depending on whether this is the first window or a
 * background pre-build for a hot density swap.
 */
function buildWindow(density: Density): WindowCtx {
  const s = getSettings();
  // Explicit window icon so the taskbar / Alt-Tab shows the Parlys logo even
  // when the app runs from the stock electron.exe (the daily-use launch mode
  // on this machine — see tasks/lessons.md "target the GUI binary directly").
  // Resolves both in dev (dist/main → ../../assets) and packaged (app.asar).
  const appIcon = join(__dirname, '..', '..', 'assets', 'icon.ico');
  // Read the user's theme bg0 so the native window backgroundColor matches
  // the renderer's bg0 from the very first frame. With the previous
  // hardcoded '#07070d', a non-midnight theme briefly painted the wrong
  // dark shade between window.show() and the first composited renderer
  // frame — perceived as a "flash of the default theme" on every density
  // swap. Using the real palette eliminates the off-by-shade flash and
  // also gives the GPU a same-colour frame to interpolate from.
  const themeBg0 = getTheme(s.themeId).palette.bg0 || '#07070d';

  // Defense-in-depth webPreferences. Order matters: even if one flag is
  // mis-set in the future, the others still protect the app.
  //   - contextIsolation + sandbox isolate the renderer from Node.
  //   - webSecurity enables SOP/CSP enforcement.
  //   - webviewTag is off because we never embed <webview>.
  //   - allowRunningInsecureContent, experimentalFeatures off.
  const commonWebPrefs: Electron.WebPreferences = {
    preload: join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    spellcheck: false,
    // Defense-in-depth: prevents the renderer from spamming JS dialogs
    // (alert/confirm/prompt) that the user would have to dismiss.
    safeDialogs: true,
  };

  let win: BrowserWindow;
  if (density === 'compact') {
    const pos = s.widgetBounds ? clampToDisplays(s.widgetBounds.x, s.widgetBounds.y) : defaultPillPosition();
    win = new BrowserWindow({
      width: WIDGET.w,
      height: WIDGET.h,
      x: pos.x,
      y: pos.y,
      minWidth: WIDGET.w,
      minHeight: WIDGET.h,
      maxWidth: WIDGET.w,
      maxHeight: WIDGET.h,
      transparent: true,
      // The '#01000000' (alpha = 1/255) is invisible to the eye but
      // non-zero to DWM — critical for Windows + transparent: true.
      // With a fully-transparent backgroundColor, every pixel of the
      // window ends up alpha=0 in the final compositor output, and
      // DWM turns click-through. Any CSS alpha inside the page (even
      // 0.2) is multiplied against that zero and still lands at 0.
      // One alpha step is all we need to make the whole window
      // hit-testable while staying visually identical.
      backgroundColor: '#01000000',
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      focusable: true,
      paintWhenInitiallyHidden: true,
      icon: appIcon,
      webPreferences: commonWebPrefs,
    });
    // 'floating' (HWND_TOPMOST) — stays above every ordinary window
    // without forcing DirectX-exclusive fullscreen apps to exit their
    // mode the way 'screen-saver' did. The previous 'screen-saver'
    // level triggered WM_WINDOWPOSCHANGED broadcasts when the pill was
    // showInactive()'d, and many fullscreen apps react to those by
    // resizing / repositioning / switching out of fullscreen — which
    // is exactly what the user saw "en arrière-plan ou sur l'écran".
    // 'floating' keeps the pill visible above ordinary and composited
    // borderless-fullscreen content (videos, browser fullscreen) and
    // is the same level the comfortable main window uses.
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win = new BrowserWindow({
      width: COMFORTABLE.w,
      height: COMFORTABLE.h,
      minWidth: COMFORTABLE.minW,
      minHeight: COMFORTABLE.minH,
      // Match the user's theme bg0 so any pre-composited frame the OS
      // shows between window.show() and the first painted renderer frame
      // is the right shade — eliminates the brief mid-tone flash that
      // was perceived as a "weird flash" on density swap.
      backgroundColor: themeBg0,
      frame: false,
      titleBarStyle: 'hidden',
      show: false,
      alwaysOnTop: !!s.alwaysOnTop,
      paintWhenInitiallyHidden: true,
      icon: appIcon,
      webPreferences: commonWebPrefs,
    });
  }

  const ctx: WindowCtx = { win, density, pillMoveTimer: null, disposed: false };

  if (density === 'compact') {
    // Persist pill position on drag end (debounced). We deliberately capture
    // `ctx` in the closure instead of calling getWin(): during a density
    // swap a stale move event on the old pill would otherwise overwrite
    // widgetBounds with the new window's coordinates.
    win.on('move', () => {
      if (ctx.disposed || win.isDestroyed()) return;
      if (ctx.pillMoveTimer) clearTimeout(ctx.pillMoveTimer);
      ctx.pillMoveTimer = setTimeout(() => {
        if (ctx.disposed || win.isDestroyed()) return;
        try {
          const [x, y] = win.getPosition();
          setSettings({ widgetBounds: { x, y } });
        } catch {}
      }, 250);
    });
  }

  win.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      if (!win.isDestroyed()) win.hide();
    }
  });

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer ${level}] ${message} (${source}:${line})`);
  });

  return ctx;
}

/**
 * Load the renderer bundle for a given ctx.
 *
 * The density is passed as a URL hash (`#compact` / `#comfortable`). An
 * inline script in `index.html` reads it before any CSS rule evaluates
 * and stamps `data-density` on `<html>`, which is what keeps the hot
 * density swap flicker-free.
 */
async function loadRenderer(ctx: WindowCtx): Promise<void> {
  // Base hash is the density; append a `-sampler` suffix when
  // PARLYS_PILL_SAMPLER=1 is set so the renderer's regression sampler
  // runs. The suffix is harmless otherwise — the density bootstrap just
  // ignores anything it doesn't recognise.
  const sampler = process.env.PARLYS_PILL_SAMPLER === '1' ? '-sampler' : '';
  // Smoke-test hook: `PARLYS_START_VIEW=<view>` forces the renderer
  // to land on that view on first render (bypasses the default 'main'
  // in the Zustand store). Used by `scripts/_smoke-settings.js` to
  // verify SettingsView actually mounts without throwing a
  // ReferenceError — the kind of bug the type-check in _build-renderer
  // already catches at build time, but we double-check at runtime too.
  // The suffix is parsed by `initialView()` in `useStore.ts`.
  const startView = process.env.PARLYS_START_VIEW;
  const viewSuffix = (startView === 'main' || startView === 'history' || startView === 'settings')
    ? `;view=${startView}`
    : '';
  // Pre-paint theme: encode the user's resolved palette + effects into the
  // URL hash so the inline bootstrap in index.html can stamp CSS variables
  // on <html> BEFORE any CSS rule evaluates. Without this, the very first
  // frame paints with the Midnight defaults baked into index.css, then
  // React mounts ~10-50 ms later and overwrites them via applyTheme() —
  // visible as a violet → user-theme flash on every cold launch. Sending
  // the fully-resolved palette (rather than just the theme id) keeps the
  // bootstrap dumb: it doesn't need to know the THEMES table, only how
  // to apply tokens. shared/themes.ts stays the single source of truth.
  const s = getSettings();
  const theme = getTheme(s.themeId);
  const effects = { ...DEFAULT_EFFECTS, ...(s.themeEffects || {}), mode: theme.mode };
  const themeId = theme.id.replace(/[^a-z0-9_-]/gi, '');
  const paletteSeg = `;palette=${encodeURIComponent(JSON.stringify(theme.palette))}`;
  const effectsSeg = `;effects=${encodeURIComponent(JSON.stringify(effects))}`;
  const themeSuffix = `;theme=${themeId}${paletteSeg}${effectsSeg}`;
  // Send the scale + a `data-window=pill` hint to the bootstrap so the
  // renderer can stamp `html[data-window="pill"]` and `--pill-scale`
  // before any CSS evaluates. Only meaningful for the compact density.
  const pillScaleSeg = ctx.density === 'compact'
    ? `;pillscale=${pillDimensions().scale.toFixed(3)}`
    : '';
  // Audio-pipeline test flags (consumed by useAudioRecorder):
  //   PARLYS_AUDIO_HEAL=0 → `;audioheal=0` disables the liveness self-heal
  //     (legacy behaviour, used to A/B-prove the zombie-mic fix);
  //   PARLYS_AUDIT=1      → `;audit=1` exposes window.__parlysAudioAudit
  //     (state snapshots + pipeline-kill simulators for the CDP harness).
  // Both are inert in normal production launches.
  const audioFlags =
    (process.env.PARLYS_AUDIO_HEAL === '0' ? ';audioheal=0' : '') +
    (process.env.PARLYS_AUDIT === '1' ? ';audit=1' : '');
  const hash = ctx.density + sampler + viewSuffix + themeSuffix + pillScaleSeg + audioFlags;
  if (isDev) {
    await ctx.win.loadURL(`${DEV_URL}#${hash}`);
    if (process.env.PARLYS_DEVTOOLS === '1' && ctx.density === 'comfortable') {
      ctx.win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await ctx.win.loadFile(join(__dirname, '..', 'renderer', 'index.html'), { hash });
  }
}

/**
 * Resolve once the window has reliably produced its first CORRECT frame.
 *
 * Two independent signals must fire before we consider the window safe to
 * show during a density hot-swap:
 *
 *  1. `ready-to-show`  — Electron/OS: the compositor has a real frame.
 *  2. `renderer-ready` — our JS side: React has committed its first render
 *                       and a `requestAnimationFrame` has elapsed, so we
 *                       know the committed pixels are actually on screen.
 *
 * Waiting for both removes the ≈50 ms window where `ready-to-show` has
 * fired but React still shows its default/empty shell. A 2-second cap is
 * applied so a broken renderer never freezes the UI.
 */
function waitForFirstPaint(ctx: WindowCtx): Promise<void> {
  return new Promise<void>((resolve) => {
    let nativeReady = false;
    let rendererReady = false;
    let settled = false;

    const maybeResolve = () => {
      if (settled || !nativeReady || !rendererReady) return;
      settled = true;
      ipcMain.off('parlys:renderer-ready', onRendererReady);
      clearTimeout(cap);
      clearTimeout(softCap);
      resolve();
    };

    const onReadyToShow = () => {
      nativeReady = true;
      maybeResolve();
    };

    const onRendererReady = (event: Electron.IpcMainEvent) => {
      // Reject stray signals from siblings (e.g. previous swap).
      if (ctx.win.isDestroyed() || event.sender !== ctx.win.webContents) return;
      rendererReady = true;
      maybeResolve();
    };

    ctx.win.once('ready-to-show', onReadyToShow);
    ipcMain.on('parlys:renderer-ready', onRendererReady);

    // Soft cap: if the native ready-to-show fired but rendererReady is
    // still pending after 400 ms, proceed anyway. Happens on cold cache
    // when React's hydration waits for a module that's slow to parse —
    // the #root fade-in choreography doesn't depend on React having
    // committed (the inline script in index.html drives it), so the
    // user sees a smooth fade-in regardless.
    const softCap = setTimeout(() => {
      if (settled) return;
      if (nativeReady) {
        settled = true;
        ipcMain.off('parlys:renderer-ready', onRendererReady);
        clearTimeout(cap);
        resolve();
      }
    }, 400);

    // Hard cap: show the window anyway after 1.5 s so a broken renderer
    // can never leave the user with a perpetually hidden pill/main window.
    const cap = setTimeout(() => {
      if (settled) return;
      settled = true;
      ipcMain.off('parlys:renderer-ready', onRendererReady);
      clearTimeout(softCap);
      resolve();
    }, 1500);
  });
}

/** Fully release a ctx: clears its timer, removes handlers, destroys. */
function disposeCtx(ctx: WindowCtx): void {
  ctx.disposed = true;
  if (ctx.pillMoveTimer) {
    clearTimeout(ctx.pillMoveTimer);
    ctx.pillMoveTimer = null;
  }
  if (!ctx.win.isDestroyed()) {
    // Un-track the HWND BEFORE destroy so the focus tracker's set
    // doesn't accumulate dead entries across many density swaps.
    try { unregisterOwnWindow(ctx.win); } catch {}
    try { ctx.win.removeAllListeners('close'); } catch {}
    try { ctx.win.destroy(); } catch {}
  }
}

async function createWindow(): Promise<void> {
  const forced = process.env.PARLYS_FORCE_DENSITY as Density | undefined;
  const density: Density =
    forced === 'compact' || forced === 'comfortable' ? forced : getSettings().density;
  const ctx = buildWindow(density);
  current = ctx;

  // Load the bundle and wait for BOTH the native ready-to-show and React's
  // rendererReady signal before showing the window, so the very first
  // visible frame is the correct pill / comfortable UI — no blank shell.
  await loadRenderer(ctx);
  await waitForFirstPaint(ctx);

  if (ctx.disposed || ctx.win.isDestroyed()) return;

  // Honour --hidden CLI arg (set when launched by Windows auto-start) and
  // the `startMinimized` setting: in both cases we stay in the tray only.
  const hidden = process.argv.includes('--hidden') || !!getSettings().startMinimized;
  if (hidden) {
    registerOwnWindow(ctx.win);
    return;
  }
  // Show the pill WITHOUT stealing focus, so whatever the user was doing
  // remains active (critical for injection to keep working).
  if (density === 'compact') {
    ctx.win.showInactive();
  } else {
    ctx.win.show();
  }
  registerOwnWindow(ctx.win);
}

/**
 * Hot-swap the window between densities without a visible gap.
 *
 * Strategy:
 *   1. Persist the new density so the incoming renderer hydrates correctly.
 *   2. Build the new window HIDDEN and load the renderer.
 *   3. Wait for its first paint (`ready-to-show` + renderer-ready).
 *   4. Kick off the OLD window's fade-out (CSS `html.is-leaving`, 120 ms),
 *      in parallel with the NEW window's built-in fade-in (the inline
 *      script in `index.html` stamps `is-entering` at parse time, then
 *      clears it at the 2nd rAF — so the 180 ms fade is either complete
 *      or already mid-flight by the time we make the window visible).
 *   5. Wait ~130 ms for the fade-out to (mostly) finish, then show the
 *      new window and dispose the old one on the next tick.
 *
 * Calls are serialised via `swapInFlight` so repeated clicks can't race.
 */
async function swapDensity(density: Density): Promise<void> {
  if (swapInFlight) { await swapInFlight; }
  swapInFlight = (async () => {
    const prev = current;
    if (prev && prev.density === density && !prev.win.isDestroyed()) return;

    // 1. Persist BEFORE building so the new renderer hydrates with the
    //    correct density on first paint.
    setSettings({ density });

    // 2. Build hidden + load.
    const next = buildWindow(density);
    try {
      await loadRenderer(next);
    } catch (e) {
      console.warn('[swap] loadRenderer failed', e);
      disposeCtx(next);
      return;
    }
    await waitForFirstPaint(next);

    // 3. Tell the OLD renderer to fade-out (120 ms CSS transition).
    //    The new renderer, off-screen, is already mid-fade-in from its
    //    inline bootstrap. We give the fade-out a generous 160 ms (vs
    //    the 120 ms CSS duration) to absorb IPC latency + the renderer's
    //    requestAnimationFrame scheduling so the cross-fade is never
    //    cut short — at the previous 130 ms margin, a ~10 ms IPC stall
    //    would let the old pill at ~4% opacity peek out the moment the
    //    new window appeared, perceived as a visible "step" in the swap.
    const wasVisible = prev ? prev.win.isVisible() : true;
    if (prev && !prev.win.isDestroyed() && wasVisible) {
      try { prev.win.webContents.send('parlys:densitySwapOut'); } catch { /* ignore */ }
      await new Promise<void>((r) => setTimeout(r, 160));
    }

    // 4. Show the new window. Its #root is either already at opacity 1
    //    (if load took > 180 ms) or still animating — either way the
    //    visual is smooth because we never show an opaque new frame on
    //    top of an opaque old one.
    if (wasVisible) {
      if (density === 'compact') next.win.showInactive();
      else next.win.show();
    }
    registerOwnWindow(next.win);

    // 5. Flip the reference atomically. From here on, `getWin()` points
    //    at the new window.
    current = next;

    // 6. Defer the teardown a tick so the new frame is guaranteed to be
    //    on-screen before the old HWND vanishes (avoids a 1-frame flash
    //    on some GPU drivers).
    if (prev) {
      setImmediate(() => disposeCtx(prev));
    }
  })();
  try { await swapInFlight; } finally { swapInFlight = null; }
}

/**
 * Pop a right-click context menu on the pill. Called from the renderer via
 * IPC so the menu renders natively (no transparency issues).
 */
function showWidgetContextMenu(): void {
  const w = getWin();
  if (!w) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Agrandir (mode confortable)',
      click: async () => {
        await swapDensity('comfortable');
      },
    },
    {
      label: 'Ouvrir les paramètres',
      click: async () => {
        await swapDensity('comfortable');
        const nw = getWin();
        nw?.webContents.send('parlys:openSettings');
      },
    },
    { type: 'separator' },
    {
      label: 'Masquer la pilule',
      click: () => w.hide(),
    },
    {
      label: 'Quitter Parlys',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      },
    },
  ]);
  menu.popup({ window: w });
}

/** Reconcile the OS login-item state with our saved `autoStart` setting. */
function reconcileAutoStart(): void {
  try {
    const s = getSettings();
    app.setLoginItemSettings({
      openAtLogin: !!s.autoStart,
      args: s.autoStart ? ['--hidden'] : [],
    });
  } catch (e) {
    console.warn('[autostart]', e);
  }
}

/**
 * Origins the renderer is allowed to navigate to. Production = our bundled
 * file:// URL. Development = the Vite dev server. Anything else (e.g. a
 * compromised renderer trying to load example.com) is blocked and opened
 * in the user's default browser instead.
 */
function isAllowedRendererOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true;
    if (isDev && u.origin === new URL(DEV_URL).origin) return true;
    // DevTools extensions use devtools:// — tolerated.
    if (u.protocol === 'devtools:') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Attach defense-in-depth guards to every webContents we create. This is a
 * belt-and-braces layer on top of contextIsolation + sandbox: even if the
 * renderer were compromised, it can't redirect our window to a phishing
 * page or spawn arbitrary BrowserWindows.
 */
function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Block in-place navigations to any non-whitelisted origin.
    contents.on('will-navigate', (e, url) => {
      if (!isAllowedRendererOrigin(url)) {
        e.preventDefault();
        try { shell.openExternal(url); } catch {}
      }
    });

    // Any target=_blank link or window.open() opens in the user's default
    // browser — we never spawn a new BrowserWindow from the renderer.
    contents.setWindowOpenHandler(({ url }) => {
      try { shell.openExternal(url); } catch {}
      return { action: 'deny' };
    });

    // Refuse <webview> attachment in case the flag ever slips back on.
    contents.on('will-attach-webview', (e) => e.preventDefault());

    // Permission handler — explicit allow-list scoped to our OWN renderer
    // origin (file:// in prod, the Vite dev server in dev). Without the
    // origin scope, any HTML page our renderer somehow loaded could grab
    // the mic. We also refuse 'media' requests that include video — this
    // is a dictation app, never a camera app.
    contents.session.setPermissionRequestHandler((_wc, permission, cb, details) => {
      if (permission !== 'media') return cb(false);
      const url = (details as any)?.requestingUrl as string | undefined;
      if (!url || !isAllowedRendererOrigin(url)) return cb(false);
      const types = (details as any)?.mediaTypes as string[] | undefined;
      if (Array.isArray(types) && types.includes('video')) return cb(false);
      cb(true);
    });
    // Mirror for navigator.permissions.query() (synchronous path).
    contents.session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (permission !== 'media') return false;
      return !!requestingOrigin && isAllowedRendererOrigin(requestingOrigin);
    });
  });
}

// Test-only: expose Chrome DevTools Protocol on :9222 so the hover /
// drag regression harness can dispatch Input.dispatchMouseEvent (the
// only reliable way to trigger mouse events in a transparent
// alwaysOnTop window on Windows — SendInput is silently dropped) and
// read the renderer console in real time. Never set in production.
if (process.env.PARLYS_CDP === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

// Test-only: feed getUserMedia from a WAV file instead of the real mic so
// the e2e harness (scripts/_e2e-mic.js) is deterministic — speech, silence
// and noise fixtures produce reproducible pipeline behaviour. Env-driven
// (not argv) so the harness doesn't depend on Electron's argv→Chromium
// switch forwarding. Never set in production.
if (process.env.PARLYS_FAKE_AUDIO) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.PARLYS_FAKE_AUDIO);
}

app.whenReady().then(async () => {
  installNavigationGuards();
  registerIpc();
  // macOS: probe Accessibility permission at boot. Without it, our osascript
  // keystroke injection runs but the OS silently drops the keys — paste
  // looks broken with zero error. The probe logs a clear warning telling
  // the user where to grant the permission. No-op on Windows/Linux.
  if (process.platform === 'darwin') {
    try {
      const { checkMacAccessibility } = await import('./services/injection');
      await checkMacAccessibility();
    } catch (e) { console.warn('[boot] accessibility probe failed', e); }
  }
  reconcileAutoStart();

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => getWin()?.minimize());
  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    const w = getWin();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.handle(IPC.WINDOW_CLOSE, () => getWin()?.close());
  ipcMain.handle(IPC.WINDOW_SET_ALWAYS_ON_TOP, (_e, enabled: boolean) => {
    const w = getWin();
    setSettings({ alwaysOnTop: !!enabled });
    if (w && getSettings().density === 'comfortable') {
      w.setAlwaysOnTop(!!enabled, 'floating');
    }
  });
  ipcMain.handle(IPC.WINDOW_RESIZE_FOR_DENSITY, async (_e, density: Density) => {
    if (density !== 'compact' && density !== 'comfortable') return;
    await swapDensity(density);
  });
  ipcMain.handle(IPC.WIDGET_CONTEXT_MENU, () => showWidgetContextMenu());
  ipcMain.handle(IPC.LOG, (_e, ...args) => console.log('[renderer]', ...args));

  // Focus tracking runs the whole app lifetime so the HWND history is
  // always up to date regardless of density / recreates.
  try { initFocusTracking(); } catch (e) { console.warn('[focus]', e); }

  // System sleep/wake → tell every renderer to re-verify its warm audio
  // pipeline. After Windows resume, a getUserMedia stream + AudioContext
  // frequently keep claiming they're fine while onaudioprocess never fires
  // again ("zombie mic": speech silently undetected until the window was
  // recreated). The recorder hook rebuilds proactively on this signal so
  // the mic is alive again seconds after wake — before the next dictation.
  // 'unlock-screen' included: some sleep paths only surface as a lock.
  const broadcastSystemResumed = (why: string) => {
    console.log(`[power] ${why} → renderers notified (audio pipeline re-check)`);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try { win.webContents.send('parlys:systemResumed'); } catch { /* ignore */ }
    }
  };
  try {
    powerMonitor.on('resume', () => broadcastSystemResumed('resume'));
    powerMonitor.on('unlock-screen', () => broadcastSystemResumed('unlock-screen'));
  } catch (e) { console.warn('[power]', e); }

  await createWindow();
  try { createTray(getWin); } catch (e) { console.warn('[tray]', e); }
  try { registerShortcuts(getWin); } catch (e) { console.warn('[shortcuts]', e); }
  // Auto-updater : silent background check 15s after boot, then every 4h.
  // No-op in dev (see src/main/updater.ts). In packaged builds it reads
  // `app-update.yml` embedded by electron-builder and polls GitHub Releases.
  try { initUpdater(); } catch (e) { console.warn('[updater]', e); }
  // Note: 'second-instance' handler is registered earlier in this
  // file (at module import time) so it's live before whenReady
  // resolves — see the block right after requestSingleInstanceLock.
});

app.on('window-all-closed', () => {
  // keep tray alive
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
  unregisterShortcuts();
  stopFocusTracking();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
