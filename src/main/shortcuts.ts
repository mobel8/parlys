import { globalShortcut, BrowserWindow } from 'electron';
import { IPC } from '../shared/types';
import { getSettings, setSettings } from './services/config';

let registered: string[] = [];
/**
 * Last `getWin` getter passed to `registerShortcuts()` — cached so
 * `reRegisterShortcuts()` can be called from the SET_SETTINGS IPC
 * handler without having to re-thread the reference from `index.ts`.
 * Set on the first call to `registerShortcuts()`.
 */
let lastGetWin: (() => BrowserWindow | null) | null = null;

/**
 * Fire the toggle event to the renderer, making the window visible first
 * (without stealing focus) if it was hidden.
 */
function fireToggle(getWin: () => BrowserWindow | null): void {
  const w = getWin();
  if (!w) return;
  if (!w.isVisible()) {
    try { w.showInactive(); } catch {}
  }
  w.webContents.send(IPC.ON_TOGGLE_RECORDING);
}

/**
 * Flip `interpreterEnabled` in the persisted settings and broadcast
 * the new settings to every live renderer so the UI reflects the
 * change immediately (the emerald "Interprète vocal" chip lights up
 * or dims, the master-switch in Settings follows).
 *
 * Fired by the `shortcutInterpreter` accelerator. Does NOT start or
 * stop recording — it only flips the routing so the NEXT recording
 * goes through the interpreter pipeline. The user still has to press
 * their dictation hotkey (or click the big button) to actually talk.
 *
 * We surface the window when it was hidden in the tray so the user
 * sees the change visually — otherwise flipping a global hotkey
 * with nothing visible would feel like a silent no-op.
 */
function fireInterpreterToggle(getWin: () => BrowserWindow | null): void {
  const current = getSettings();
  const next = setSettings({ interpreterEnabled: !current.interpreterEnabled });
  const w = getWin();
  if (w && !w.isVisible()) {
    try { w.showInactive(); } catch {}
  }
  // Broadcast to EVERY window (main + any future secondary) so the
  // store in each renderer re-sync their `settings` slice.
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try { win.webContents.send(IPC.ON_SETTINGS_CHANGED, next); } catch { /* ignore */ }
  }
}

/**
 * Register the configured global shortcuts.
 *
 * NOTE on Push-to-Talk: Electron's `globalShortcut` does NOT emit key-up
 * events on Windows. A true "hold to talk, release to stop" needs either a
 * low-level keyboard hook (native, complex) or a separate PTT-specific
 * mechanism. For now PTT is registered as a second accelerator that also
 * toggles — giving the user an alternative hotkey they can bind to a
 * different key (e.g. a macro pad button) without conflicting with the
 * primary toggle. If/when we add a real PTT via native hook, we'll fire
 * `ON_PTT_DOWN` / `ON_PTT_UP` from there.
 */
export function registerShortcuts(getWin: () => BrowserWindow | null): void {
  unregisterShortcuts();
  lastGetWin = getWin;
  const s = getSettings();

  try {
    if (s.shortcutToggle) {
      const ok = globalShortcut.register(s.shortcutToggle, () => fireToggle(getWin));
      if (ok) registered.push(s.shortcutToggle);
      else console.warn('[shortcuts] toggle registration refused (key in use?):', s.shortcutToggle);
    }
  } catch (e) {
    console.warn('[shortcuts] failed to register toggle:', e);
  }

  try {
    if (s.pttEnabled && s.shortcutPTT && s.shortcutPTT !== s.shortcutToggle) {
      const ok = globalShortcut.register(s.shortcutPTT, () => fireToggle(getWin));
      if (ok) registered.push(s.shortcutPTT);
      else console.warn('[shortcuts] PTT registration refused (key in use?):', s.shortcutPTT);
    }
  } catch (e) {
    console.warn('[shortcuts] failed to register PTT:', e);
  }

  try {
    if (
      s.shortcutInterpreter &&
      s.shortcutInterpreter !== s.shortcutToggle &&
      s.shortcutInterpreter !== s.shortcutPTT
    ) {
      const ok = globalShortcut.register(s.shortcutInterpreter, () => fireInterpreterToggle(getWin));
      if (ok) registered.push(s.shortcutInterpreter);
      else console.warn('[shortcuts] interpreter registration refused (key in use?):', s.shortcutInterpreter);
    }
  } catch (e) {
    console.warn('[shortcuts] failed to register interpreter:', e);
  }
}

/**
 * Re-run the registration using the last `getWin` seen by
 * `registerShortcuts`. Used by the SET_SETTINGS IPC handler to pick
 * up live changes to any of the three accelerator fields without
 * requiring an app restart.
 */
export function reRegisterShortcuts(): void {
  if (!lastGetWin) return;
  registerShortcuts(lastGetWin);
}

export function unregisterShortcuts(): void {
  for (const acc of registered) {
    try { globalShortcut.unregister(acc); } catch {}
  }
  registered = [];
}
