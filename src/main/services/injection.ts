import { clipboard, BrowserWindow } from 'electron';
import { exec } from 'child_process';
import { platform } from 'os';
import { getLastExternalHwnd } from './focus';
import { getWin32, pointerToHwnd, VK } from './win32';

/** Win32 ShowWindow verbs we actually use. */
const SW_RESTORE = 9;

export function copyToClipboard(text: string): void {
  clipboard.writeText(text);
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
  clipboard.writeText(text);

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
      exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, () => resolve());
    });
  } else {
    await new Promise((r) => setTimeout(r, 80));
    await new Promise<void>((resolve) => exec('xdotool key ctrl+v', () => resolve()));
  }
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
