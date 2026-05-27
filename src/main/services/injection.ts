import { app, clipboard, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import { platform } from 'os';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { getLastExternalHwnd } from './focus';
import { getWin32, pointerToHwnd, VK } from './win32';
import { sanitizeInjectionText } from './validate';
import { getSettings } from './config';

// Opt-in trace log for the paste pipeline. Off by default. Set
// VOICEINK_DEBUG_INJECT=1 in the environment to dump one line per inject
// call to %APPDATA%\voiceink\inject-debug.log — useful when a user
// reports "ne colle pas dans X" so we can confirm exactly which HWND
// was targeted, which was foreground at keystroke time, and whether
// keybd_event was reached. Electron stdout isn't reliably flushed to
// the redirected runtime.log on Windows, hence the file fallback.
const DEBUG_INJECT = process.env.VOICEINK_DEBUG_INJECT === '1';
function diagLog(...parts: unknown[]): void {
  if (!DEBUG_INJECT) return;
  try {
    const line = `[${new Date().toISOString()}] [inject] ${parts.map(String).join(' ')}\n`;
    appendFileSync(join(app.getPath('userData'), 'inject-debug.log'), line);
  } catch { /* best-effort */ }
}

/** Win32 ShowWindow verbs we actually use. */
const SW_RESTORE = 9;

export function copyToClipboard(text: string): void {
  clipboard.writeText(sanitizeInjectionText(text));
}

/**
 * Inject text into the target app:
 *   1. Copy text to clipboard.
 *   2. Blur our window(s) so Windows-level focus releases us.
 *   3. On Windows: call `SetForegroundWindow(targetHwnd)` + `keybd_event(Ctrl+V)`
 *      directly via koffi. No child process, no console flash.
 *   4. Fallback to PowerShell only if koffi is unavailable.
 *   5. macOS/Linux: osascript / xdotool.
 *
 * We do NOT restore the previous clipboard: users expect the transcription
 * to remain available for re-pasting.
 */
export async function injectText(text: string): Promise<void> {
  // Strip C0 control chars + Unicode bidi-override marks (Trojan Source)
  // before the clipboard write. Defense-in-depth against LLM hallucinations
  // or replacements rules that would inject hidden control bytes — these
  // are interpreted as commands when pasted into a terminal or messaging
  // app. Keep tab/LF/CR (legitimate whitespace).
  const safe = sanitizeInjectionText(text);
  clipboard.writeText(safe);
  diagLog(`called len=${safe.length} preview="${safe.slice(0, 40)}"`);

  // Blur our windows so focus can move to the target app.
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.blur(); } catch {}
  }

  const os = platform();
  if (os === 'win32') {
    const targetHwnd = getLastExternalHwnd();
    // Per-user injection mode. `paste` (Ctrl+V) is fast and the historical
    // default; `type` writes each character via SendInput KEYEVENTF_UNICODE
    // and is the ONLY thing that works inside terminal TUI apps (Claude
    // Code, vim, tmux, REPLs) that consume keystrokes in raw mode and
    // never translate Ctrl+V to a clipboard paste.
    const settings = getSettings();
    const mode = (settings as any).injectMode === 'type' ? 'type' : 'paste';
    diagLog(`win32 mode=${mode} targetHwnd=${targetHwnd}`);
    if (mode === 'type') {
      const ok = await sendTextNative(safe, targetHwnd);
      diagLog(`sendTextNative returned ${ok}`);
      if (!ok) {
        // If SendInput Unicode is unavailable (no koffi, etc.) fall back to
        // paste so at least the clipboard is populated for manual Ctrl+V.
        await sendPasteNative(targetHwnd);
      }
    } else {
      const ok = await sendPasteNative(targetHwnd);
      diagLog(`sendPasteNative returned ${ok}`);
      if (!ok) {
        console.warn('[inject] native path unavailable, using PowerShell fallback');
        await sendPastePowerShell(targetHwnd);
      }
    }
  } else if (os === 'darwin') {
    await new Promise((r) => setTimeout(r, 80));
    await new Promise<void>((resolve) => {
      exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, (err) => {
        if (err) console.warn('[inject] osascript failed (Accessibility permission?):', err.message);
        resolve();
      });
    });
  } else {
    // Linux: Wayland uses different injection tools than X11.
    // xdotool only works on X11 — on Wayland it fails silently because
    // the compositor isolates apps from synthetic input. Detect via
    // WAYLAND_DISPLAY and try wtype (simple) then ydotool (needs daemon).
    const isWayland = !!process.env.WAYLAND_DISPLAY;
    await new Promise((r) => setTimeout(r, 80));
    if (isWayland) {
      const tryWtype = await execAndCheck('wtype -M ctrl v -m ctrl');
      if (!tryWtype) {
        // ydotool key codes: 29=LeftCtrl, 47=V. Format: code:state (1=down, 0=up).
        const tryYdotool = await execAndCheck('ydotool key 29:1 47:1 47:0 29:0');
        if (!tryYdotool) {
          console.warn('[inject] Wayland: neither wtype nor ydotool available — paste failed');
        }
      }
    } else {
      await new Promise<void>((resolve) => exec('xdotool key ctrl+v', (err) => {
        if (err) console.warn('[inject] xdotool failed:', err.message);
        resolve();
      }));
    }
  }
}

/** Run a shell command and resolve true on exit 0, false on any error. */
function execAndCheck(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(cmd, (err) => resolve(!err));
  });
}

/**
 * macOS-only: detect whether the app has been granted Accessibility permission.
 * Without it, osascript runs but the keystroke is silently swallowed by the OS
 * — the user sees nothing pasted with no visible error. We probe at boot and
 * log a clear warning so the user knows to enable it in System Settings.
 *
 * Returns true if permission appears granted, false otherwise. The check is
 * best-effort: if osascript itself fails we err on the side of "probably ok"
 * to avoid false negatives.
 */
export async function checkMacAccessibility(): Promise<boolean> {
  if (platform() !== 'darwin') return true;
  return new Promise((resolve) => {
    // `System Events` requires Accessibility. A no-op query (count processes)
    // returns an error string with code -1719 or -25211 if denied.
    exec(
      `osascript -e 'tell application "System Events" to count processes'`,
      { timeout: 3000 },
      (err, _stdout, stderr) => {
        const msg = (stderr || err?.message || '').toLowerCase();
        const denied =
          msg.includes('not authorized') ||
          msg.includes('-1719') ||
          msg.includes('-25211') ||
          msg.includes('assistive');
        if (denied) {
          console.warn(
            '[inject] macOS Accessibility permission NOT granted — paste will fail silently. ' +
              'Enable VoiceInk in System Settings → Privacy & Security → Accessibility.',
          );
          resolve(false);
          return;
        }
        resolve(true);
      },
    );
  });
}

/**
 * Native Windows paste via koffi. Returns true on success, false if
 * koffi is unavailable (caller should fall back).
 *
 * Flow (all synchronous native calls, no process spawn):
 *   1. SetForegroundWindow(hwnd)  —  bring target app to foreground
 *   2. ShowWindow(hwnd, SW_SHOW)  —  in case it was minimised
 *   3. Wait ~40 ms for the OS to commit the focus change
 *   4. keybd_event Ctrl down, V down, V up, Ctrl up  —  delivers Ctrl+V
 *      to the active app (which is now the target).
 *
 * Total latency ~50-80 ms and no visible UI change anywhere.
 */
/**
 * Force `targetHwnd` to the foreground even when the calling process
 * isn't itself foreground (which is the normal VoiceInk state — the
 * pill is shown via `showInactive` and the main process never owns
 * focus). A naked `SetForegroundWindow` from a non-foreground process
 * is blocked by Windows' focus-stealing prevention.
 *
 * The workaround is the well-known `AttachThreadInput` trick: while
 * our message thread is "attached" to the foreground thread's input
 * queue, we share its focus rights, so `SetForegroundWindow` succeeds.
 * We detach immediately afterwards — leaving threads attached would
 * make our keyboard input route through the wrong thread for the rest
 * of the session.
 *
 * No-ops if the target is already foreground.
 */
async function forceFocus(w: any, hwnd: string): Promise<void> {
  try {
    const h = BigInt(hwnd);
    if (!w.IsWindow(h)) return;
    if (w.IsIconic(h)) w.ShowWindow(h, 9 /* SW_RESTORE */);

    const currentFgPtr = w.GetForegroundWindow();
    const currentFg = pointerToHwnd(currentFgPtr, w);
    if (currentFg === hwnd) {
      diagLog(`already foreground (${hwnd})`);
      return;
    }

    // Plain SetForegroundWindow first — sometimes it just works (the
    // calling process IS allowed if it just received a hotkey via
    // RegisterHotKey, which globalShortcut uses).
    let ok = w.SetForegroundWindow(h);
    if (ok) { diagLog(`SetForegroundWindow ok (no attach)`); return; }

    // Failed — attach to the foreground thread's input queue so the OS
    // treats us as the foreground process while we re-issue the call.
    const fgThreadId = w.GetWindowThreadProcessId(BigInt(currentFg || '0'), null);
    const ourThreadId = w.GetCurrentThreadId();
    if (fgThreadId && fgThreadId !== ourThreadId) {
      w.AttachThreadInput(ourThreadId, fgThreadId, 1);
      try {
        w.BringWindowToTop(h);
        ok = w.SetForegroundWindow(h);
        diagLog(`SetForegroundWindow after attach: ${ok}`);
      } finally {
        w.AttachThreadInput(ourThreadId, fgThreadId, 0);
      }
    } else {
      diagLog(`could not get fg thread id (current=${currentFg})`);
    }
    if (!ok) console.log('[inject] SetForegroundWindow still 0 after attach — input may go to wrong window');
  } catch (e: any) {
    console.warn('[inject] forceFocus error:', e?.message || e);
  }
}

async function sendPasteNative(hwnd: string | null): Promise<boolean> {
  const w = getWin32();
  if (!w) { diagLog('koffi unavailable, returning false'); return false; }

  try {
    if (hwnd) {
      try {
        const h = BigInt(hwnd);
        // Validate still a window (target may have closed between poll and now).
        const valid = w.IsWindow(h);
        diagLog(`IsWindow(${hwnd})=${valid}`);
        if (valid) {
          // Only un-minimise if the window is actually iconic. Calling
          // ShowWindow(SW_SHOW) on a non-minimised window is NOT a
          // no-op: fullscreen / exclusive apps redraw and can exit
          // their fullscreen state. SW_RESTORE is the proper verb for
          // "un-minimise without activating any more than necessary".
          if (w.IsIconic(h)) {
            w.ShowWindow(h, SW_RESTORE);
          }
          // Only re-foreground the target if it's not already the
          // foreground window. In the common case (user pressed the
          // global shortcut, pill appeared via showInactive which
          // doesn't steal focus), the target was foreground all along
          // — calling SetForegroundWindow(target) then is redundant
          // and triggers extra activation work that some fullscreen
          // apps misinterpret as a focus-change, causing them to
          // reposition or exit fullscreen.
          const currentFgPtr = w.GetForegroundWindow();
          const currentFg = pointerToHwnd(currentFgPtr, w);
          diagLog(`currentFg=${currentFg} target=${hwnd} match=${currentFg === hwnd}`);
          if (currentFg !== hwnd) {
            const ok = w.SetForegroundWindow(h);
            diagLog(`SetForegroundWindow(${hwnd}) returned ${ok}`);
            if (!ok) {
              // SetForegroundWindow can fail due to Win32 focus-stealing
              // prevention. We log and proceed — the paste may still
              // land correctly because keybd_event targets whichever
              // window currently has the keyboard focus.
              console.log('[inject] SetForegroundWindow returned 0, proceeding anyway');
            }
          }
        }
      } catch (e: any) {
        console.warn('[inject] foreground restore error:', e?.message || e);
      }
    }

    // Let the OS commit the focus change before sending keystrokes.
    await new Promise((r) => setTimeout(r, 40));

    // Re-sample the foreground right before the keystroke fires — this tells
    // us where Ctrl+V is actually going to land, in case SetForegroundWindow
    // silently failed (focus-steal prevention) or another app stole focus.
    try {
      const finalFgPtr = w.GetForegroundWindow();
      const finalFg = pointerToHwnd(finalFgPtr, w);
      diagLog(`pre-keystroke foreground=${finalFg}`);
    } catch {}

    // Ctrl down, V down, V up, Ctrl up — deliver Ctrl+V.
    w.keybd_event(VK.CONTROL, 0, 0, 0);
    w.keybd_event(VK.V, 0, 0, 0);
    w.keybd_event(VK.V, 0, VK.KEYEVENTF_KEYUP, 0);
    w.keybd_event(VK.CONTROL, 0, VK.KEYEVENTF_KEYUP, 0);
    diagLog('keybd_event Ctrl+V dispatched');

    return true;
  } catch (err: any) {
    diagLog(`native paste error: ${err?.message || err}`);
    console.warn('[inject] native paste error:', err?.message || err);
    return false;
  }
}

/**
 * Type `text` into the target window one Unicode codepoint at a time via
 * SendInput with KEYEVENTF_UNICODE. Works in EVERY input target — regular
 * text fields AND terminal TUI apps (Claude Code, vim, tmux, REPL) that
 * read keystrokes via ReadConsoleInput in raw mode and never translate
 * Ctrl+V to a clipboard paste.
 *
 * Cost: ~50 µs per character of OS overhead. A typical 200-char dictation
 * lands in ~10 ms total, imperceptible.
 *
 * Newlines (\n) are emitted as a VK_RETURN press+release pair rather than
 * a Unicode U+000A because TUI line editors react more reliably to the
 * scancode form ("press Enter to submit" semantics).
 */
async function sendTextNative(text: string, hwnd: string | null): Promise<boolean> {
  const w = getWin32();
  if (!w || !w.SendInput) { diagLog('SendInput unavailable, returning false'); return false; }

  try {
    if (hwnd) {
      await forceFocus(w, hwnd);
    }
    // Re-sample foreground RIGHT before typing so the diag log shows
    // whether our focus dance actually landed on the target.
    try {
      const ptr = w.GetForegroundWindow();
      const fg = pointerToHwnd(ptr, w);
      diagLog(`pre-type foreground=${fg} target=${hwnd}`);
    } catch {}
    await new Promise((r) => setTimeout(r, 40));

    const KEYBDINPUT = (w as any)._KEYBDINPUT;
    const VK_RETURN = 0x0D;
    // Use the BMP path for codepoints ≤ 0xFFFF. Higher codepoints (emoji,
    // some CJK) need UTF-16 surrogate pairs — we expand via codePointAt and
    // emit each 16-bit code unit as its own SendInput event. The OS
    // reassembles the surrogate pair into the original codepoint.
    const codeUnits: number[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (ch === '\n') {
        codeUnits.push(-VK_RETURN); // negative sentinel = use VK, not Unicode
        continue;
      }
      if (cp <= 0xFFFF) {
        codeUnits.push(cp);
      } else {
        // Surrogate pair
        const offset = cp - 0x10000;
        codeUnits.push(0xD800 + (offset >> 10));
        codeUnits.push(0xDC00 + (offset & 0x3FF));
      }
    }

    // Batch into chunks of 64 events (one event = press+release pair).
    // SendInput accepts an array — fewer calls = less context-switch overhead.
    const BATCH = 64;
    const inputs: any[] = [];
    const flush = () => {
      if (inputs.length === 0) return;
      // koffi marshals the JS array directly into a contiguous block of
      // `KEYBDINPUT_pad`-shaped structs because that's how we declared the
      // SendInput signature in win32.ts.
      const sent = w.SendInput(inputs.length, inputs, w.inputStructSize);
      if (sent !== inputs.length) {
        diagLog(`SendInput partial: ${sent}/${inputs.length}`);
      }
      inputs.length = 0;
    };
    void KEYBDINPUT; // referenced for clarity — struct is what SendInput marshals
    for (const cu of codeUnits) {
      if (cu < 0) {
        // VK key (Enter) — use scancode-free virtual-key path
        const vk = -cu;
        inputs.push(w.makeKeyInput(vk, 0, 0));
        inputs.push(w.makeKeyInput(vk, 0, VK.KEYEVENTF_KEYUP));
      } else {
        inputs.push(w.makeKeyInput(0, cu, VK.KEYEVENTF_UNICODE));
        inputs.push(w.makeKeyInput(0, cu, VK.KEYEVENTF_UNICODE | VK.KEYEVENTF_KEYUP));
      }
      if (inputs.length >= BATCH) flush();
    }
    flush();
    diagLog(`sendTextNative typed ${text.length} chars`);
    return true;
  } catch (err: any) {
    diagLog(`sendTextNative error: ${err?.message || err}`);
    console.warn('[inject] sendTextNative error:', err?.message || err);
    return false;
  }
}

/**
 * PowerShell fallback when koffi isn't available. Kept intentionally minimal
 * and with windowsHide — may still produce a brief flash on some systems,
 * which is why the native path is strongly preferred.
 */
function sendPastePowerShell(hwnd: string | null): Promise<void> {
  return new Promise((resolve) => {
    const setFg = hwnd
      ? `$null = [VoiceInk.U]::SetForegroundWindow([IntPtr]${hwnd}); Start-Sleep -Milliseconds 60;`
      : 'Start-Sleep -Milliseconds 80;';

    const script = [
      `Add-Type -Namespace VoiceInk -Name U -MemberDefinition '[System.Runtime.InteropServices.DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);' -ErrorAction SilentlyContinue;`,
      `Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue;`,
      setFg,
      `[System.Windows.Forms.SendKeys]::SendWait('^v');`,
    ].join(' ');

    const cmd = `powershell -NoProfile -WindowStyle Hidden -Command "${script}"`;
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) console.warn('[inject] PS fallback error:', err.message);
      resolve();
    });
  });
}
