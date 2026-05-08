/**
 * Foreground-window tracker for Windows — v3, fully native.
 *
 * v2 used a persistent PowerShell process polling `GetForegroundWindow`.
 * Even with `windowsHide: true`, some systems briefly flash a PS console
 * window at spawn time. v3 eliminates this entirely: we call
 * `GetForegroundWindow` directly through `koffi` (native FFI) on a Node
 * `setInterval`. Zero external processes, zero screen flicker, ~microsecond
 * call cost.
 *
 * We remember the LAST non-VoiceInk HWND so the injection layer can restore
 * focus before pasting.
 */

import { BrowserWindow } from 'electron';
import { platform } from 'os';
import { getWin32, pointerToHwnd } from './win32';

let ourHwnds: Set<string> = new Set();
let lastExternalHwnd: string | null = null;
let pollTimer: NodeJS.Timeout | null = null;

function hwndOf(win: BrowserWindow): string | null {
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || buf.length === 0) return null;
    if (buf.length >= 8) return buf.readBigUInt64LE(0).toString();
    return buf.readUInt32LE(0).toString();
  } catch {
    return null;
  }
}

function refreshOurHwnds(): void {
  ourHwnds = new Set();
  for (const w of BrowserWindow.getAllWindows()) {
    const h = hwndOf(w);
    if (h) ourHwnds.add(h);
  }
}

export function initFocusTracking(): void {
  if (platform() !== 'win32') return;

  refreshOurHwnds();
  BrowserWindow.getAllWindows().forEach((w) => {
    w.once('ready-to-show', () => refreshOurHwnds());
    w.on('show', () => refreshOurHwnds());
  });

  const w = getWin32();
  if (!w) {
    console.warn('[focus] native win32 unavailable — focus tracking disabled');
    return;
  }

  // Native polling loop — no external process, no console flash.
  pollTimer = setInterval(() => {
    try {
      const ptr = w.GetForegroundWindow();
      const hwnd = pointerToHwnd(ptr, w);
      if (!hwnd) return;
      if (ourHwnds.has(hwnd)) return;
      lastExternalHwnd = hwnd;
    } catch {
      // Ignore transient errors (e.g. during shutdown).
    }
  }, 120);

  console.log('[focus] native foreground tracker started (koffi, 120ms)');
}

export function stopFocusTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getLastExternalHwnd(): string | null {
  return lastExternalHwnd;
}

/**
 * Register an Electron BrowserWindow so its HWND is excluded from the
 * "external" foreground tracking. Call this for every window you create
 * AND whenever you recreate a window (e.g. on density toggle).
 */
export function registerOwnWindow(win: BrowserWindow): void {
  const h = hwndOf(win);
  if (h) ourHwnds.add(h);
}

/**
 * Un-track a window's HWND. Call this BEFORE destroying the window
 * (while it still has a valid native handle) so the set doesn't grow
 * monotonically across density swaps.
 */
export function unregisterOwnWindow(win: BrowserWindow): void {
  try {
    const h = hwndOf(win);
    if (h) ourHwnds.delete(h);
  } catch {
    /* ignore */
  }
}

/** Clear all tracked own-HWNDs. Call before recreating windows. */
export function resetOwnWindows(): void {
  ourHwnds = new Set();
}
