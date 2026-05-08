/**
 * Native Win32 bindings via `koffi` (pure-JS FFI with prebuilt binaries,
 * no native compile required — works in Electron out of the box).
 *
 * Used by:
 *   - `focus.ts`  →  GetForegroundWindow (to track the target app HWND)
 *   - `injection.ts` →  SetForegroundWindow + keybd_event (to paste)
 *
 * Everything is lazy-loaded so the app still boots on non-Windows platforms
 * (or if koffi can't find a prebuilt for the user's arch).
 *
 * IMPORTANT: using koffi instead of spawning PowerShell means there is
 * NEVER a visible console window flash — the user never sees the screen
 * flicker during dictation. This is the whole point of v3.
 */

import { platform } from 'os';

export interface Win32Api {
  koffi: any;
  user32: any;
  GetForegroundWindow: () => any;                 // returns HWND pointer
  SetForegroundWindow: (hwnd: bigint) => number;  // returns BOOL
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void;
  BringWindowToTop: (hwnd: bigint) => number;
  IsWindow: (hwnd: bigint) => number;
  IsIconic: (hwnd: bigint) => number;             // non-zero if minimized
  ShowWindow: (hwnd: bigint, cmdShow: number) => number;
  AttachThreadInput: (idAttach: number, idAttachTo: number, attach: number) => number;
  GetWindowThreadProcessId: (hwnd: bigint, pid: any) => number;
  GetCurrentThreadId: () => number;
}

let api: Win32Api | null = null;
let loaded = false;
let failed = false;

/**
 * Lazy-load koffi and resolve all user32 symbols. Returns null if unavailable
 * (non-Windows platform, missing prebuilt, or koffi not installed).
 */
export function getWin32(): Win32Api | null {
  if (loaded) return api;
  if (failed) return null;
  if (platform() !== 'win32') {
    failed = true;
    return null;
  }

  try {
    // Use dynamic require so webpack / ts-node don't try to resolve at build time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    // C-style signatures (koffi parses them).
    const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
    const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void* hWnd)');
    const keybd_event = user32.func(
      'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)',
    );
    const BringWindowToTop = user32.func('int __stdcall BringWindowToTop(void* hWnd)');
    const IsWindow = user32.func('int __stdcall IsWindow(void* hWnd)');
    const IsIconic = user32.func('int __stdcall IsIconic(void* hWnd)');
    const ShowWindow = user32.func('int __stdcall ShowWindow(void* hWnd, int nCmdShow)');
    const AttachThreadInput = user32.func(
      'int __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int fAttach)',
    );
    const GetWindowThreadProcessId = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)',
    );

    const kernel32 = koffi.load('kernel32.dll');
    const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()');

    api = {
      koffi,
      user32,
      GetForegroundWindow,
      SetForegroundWindow,
      keybd_event,
      BringWindowToTop,
      IsWindow,
      IsIconic,
      ShowWindow,
      AttachThreadInput,
      GetWindowThreadProcessId,
      GetCurrentThreadId,
    };
    loaded = true;
    console.log('[win32] koffi loaded — native user32 bindings active');
    return api;
  } catch (err: any) {
    failed = true;
    console.warn('[win32] failed to load koffi/user32:', err?.message || err);
    console.warn('[win32] falling back to PowerShell (may cause console flash)');
    return null;
  }
}

/**
 * Convert a koffi pointer (opaque) to its numeric HWND string.
 * Returns null for NULL / invalid pointers.
 */
export function pointerToHwnd(ptr: any, w: Win32Api): string | null {
  try {
    if (!ptr) return null;
    const addr = w.koffi.address(ptr);
    const s = typeof addr === 'bigint' ? addr.toString() : String(addr);
    return s === '0' ? null : s;
  } catch {
    return null;
  }
}

/** Virtual key codes we need for paste (Ctrl+V). */
export const VK = {
  CONTROL: 0x11,
  V: 0x56,
  KEYEVENTF_KEYUP: 0x0002,
} as const;
