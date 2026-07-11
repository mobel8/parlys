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
  /**
   * Physical/logical key state, updated as input events are processed by
   * the system (both hardware and SendInput-injected). High bit set
   * (value & 0x8000) means the key is currently DOWN. Used to detect
   * modifier keys the user is still holding (their dictation hotkey)
   * before we inject keystrokes — injecting while Ctrl/Shift/Alt/Win are
   * physically down turns every injected key into a shortcut combo in
   * the target app.
   */
  GetAsyncKeyState: (vk: number) => number;
  /**
   * Modern keyboard input API. We use it to type characters via
   * KEYEVENTF_UNICODE which works inside terminal TUI apps (Claude Code,
   * vim, tmux, etc.) that consume Ctrl+V as a raw key event without
   * mapping it to clipboard-paste.
   *
   * Accepts an array of INPUT records (built via koffi struct helpers)
   * and the size of one record. Returns the number of events
   * successfully inserted into the input stream.
   */
  SendInput: (nInputs: number, pInputs: any, cbSize: number) => number;
  INPUT_KEYBOARD: number;
  /** Build a KEYBDINPUT-shaped INPUT struct (typed as `any` because the
   *  koffi-allocated buffer is opaque to TS). */
  makeKeyInput: (wVk: number, wScan: number, dwFlags: number) => any;
  /** Size in bytes of one INPUT record — needed by SendInput. */
  inputStructSize: number;
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
    const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)');
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

    // SendInput + INPUT/KEYBDINPUT structs.
    //
    // The native INPUT union has three branches (mouse/keyboard/hardware).
    // We only ever build keyboard records, so we declare a fixed-layout
    // struct that matches INPUT-as-KEYBDINPUT on 64-bit Windows:
    //
    //   DWORD     type;        // 4 B  + 4 B padding
    //   WORD      wVk;         // 2 B
    //   WORD      wScan;       // 2 B
    //   DWORD     dwFlags;     // 4 B
    //   DWORD     time;        // 4 B
    //   ULONG_PTR dwExtraInfo; // 8 B
    //   BYTE      pad[8];      // 8 B  — pad up to MOUSEINPUT footprint
    //                                   (the union is sized to the largest
    //                                    branch; on x64 INPUT is 40 bytes)
    //
    // We pin sizeof(INPUT)=40 by hand because koffi's sizeof() of our
    // smaller KEYBDINPUT-only struct would mis-report it and SendInput
    // would treat the next record as a partial.
    // Lay out an INPUT-as-keyboard with EXPLICIT padding so the struct
    // koffi materialises is byte-for-byte the 40-byte `INPUT` Win32 expects
    // on x64. Any size mismatch with the `cbSize` arg to SendInput would
    // cause every event after the first to read garbage padding bytes.
    const KEYBDINPUT = koffi.struct('KEYBDINPUT_pad', {
      type:        'uint32',     // 0..3
      _pad0:       'uint32',     // 4..7    align union member to 8
      wVk:         'uint16',     // 8..9
      wScan:       'uint16',     // 10..11
      dwFlags:     'uint32',     // 12..15
      time:        'uint32',     // 16..19
      _pad1:       'uint32',     // 20..23  align dwExtraInfo to 8
      dwExtraInfo: 'uintptr_t',  // 24..31
      _pad2:       'uint64',     // 32..39  pad up to sizeof(INPUT)
    });
    const INPUT_STRUCT_SIZE_X64 = 40; // sizeof(INPUT) on x64
    // Declare SendInput with a pointer-to-struct param so koffi can marshal
    // a JS array of `KEYBDINPUT_pad`-shaped objects directly. With `void*`
    // koffi would have no way to compute the layout.
    const SendInput = user32.func(
      'uint32_t __stdcall SendInput(uint32_t cInputs, KEYBDINPUT_pad *pInputs, int cbSize)',
    );
    const INPUT_KEYBOARD = 1;
    const makeKeyInput = (wVk: number, wScan: number, dwFlags: number): any => ({
      type: INPUT_KEYBOARD,
      _pad0: 0,
      wVk,
      wScan,
      dwFlags,
      time: 0,
      _pad1: 0,
      dwExtraInfo: 0n,
      _pad2: 0n,
    });

    api = {
      koffi,
      user32,
      GetForegroundWindow,
      SetForegroundWindow,
      keybd_event,
      GetAsyncKeyState,
      SendInput,
      INPUT_KEYBOARD,
      makeKeyInput,
      inputStructSize: INPUT_STRUCT_SIZE_X64,
      BringWindowToTop,
      IsWindow,
      IsIconic,
      ShowWindow,
      AttachThreadInput,
      GetWindowThreadProcessId,
      GetCurrentThreadId,
    };
    // Stash the struct constructor so injection.ts can build arrays of it.
    (api as any)._KEYBDINPUT = KEYBDINPUT;
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

/** Virtual key codes + KEYEVENTF flags. */
export const VK = {
  SHIFT: 0x10,
  CONTROL: 0x11,
  /** VK_MENU = Alt (covers both left Alt and AltGr). */
  MENU: 0x12,
  LWIN: 0x5B,
  RWIN: 0x5C,
  V: 0x56,
  /** Indicates a key release. Without this flag a key event is a press. */
  KEYEVENTF_KEYUP: 0x0002,
  /** wScan carries a Unicode codepoint instead of a hardware scancode.
   *  Used to "type" arbitrary characters into apps that read WM_CHAR or
   *  ReadConsoleInput key records — works inside terminal TUI apps that
   *  ignore Ctrl+V. wVk MUST be 0 when this flag is set. */
  KEYEVENTF_UNICODE: 0x0004,
} as const;
