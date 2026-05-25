import { clipboard, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import { platform } from 'os';
import { getLastExternalHwnd } from './focus';
import { getWin32, pointerToHwnd, VK } from './win32';
import { sanitizeInjectionText } from './validate';

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

  // Blur our windows so focus can move to the target app.
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.blur(); } catch {}
  }

  const os = platform();
  if (os === 'win32') {
    const targetHwnd = getLastExternalHwnd();
    const ok = await sendPasteNative(targetHwnd);
    if (!ok) {
      console.warn('[inject] native path unavailable, using PowerShell fallback');
      await sendPastePowerShell(targetHwnd);
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
async function sendPasteNative(hwnd: string | null): Promise<boolean> {
  const w = getWin32();
  if (!w) return false;

  try {
    if (hwnd) {
      try {
        const h = BigInt(hwnd);
        // Validate still a window (target may have closed between poll and now).
        const valid = w.IsWindow(h);
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
          if (currentFg !== hwnd) {
            const ok = w.SetForegroundWindow(h);
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

    // Ctrl down, V down, V up, Ctrl up — deliver Ctrl+V.
    w.keybd_event(VK.CONTROL, 0, 0, 0);
    w.keybd_event(VK.V, 0, 0, 0);
    w.keybd_event(VK.V, 0, VK.KEYEVENTF_KEYUP, 0);
    w.keybd_event(VK.CONTROL, 0, VK.KEYEVENTF_KEYUP, 0);

    return true;
  } catch (err: any) {
    console.warn('[inject] native paste error:', err?.message || err);
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
