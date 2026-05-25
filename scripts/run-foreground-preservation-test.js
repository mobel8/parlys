#!/usr/bin/env node
/**
 * Verify that VoiceInk's pill no longer disturbs the foreground app when
 * it appears and when the shortcut toggles the recording state.
 *
 * The user's bug: "Lorsque j'utilise le logiciel en faisant par exemple
 * le raccourci, les applications qui sont en arrière-plan ou sur
 * l'écran, elles sont déplacées ou alors elles sont plus en plein
 * écran."
 *
 * The root cause (now fixed): the pill was created with
 *   win.setAlwaysOnTop(true, 'screen-saver')
 * which promotes its HWND above the screen-saver Z-order band. Windows
 * has to rearrange the whole desktop to honour that, and fullscreen /
 * maximised apps respond to the resulting WM_WINDOWPOSCHANGED by
 * exiting fullscreen or repositioning. The injection path also called
 * ShowWindow(SW_SHOW) + SetForegroundWindow unconditionally on the
 * target, which compounded the effect.
 *
 * This test:
 *   1. Launches an Electron "victim" window maximized to the primary
 *      display. It acts as a stand-in for any normal foreground app
 *      (we can't easily script a real fullscreen game, but the
 *      WM_WINDOWPOSCHANGED reaction path is the same for any
 *      maximised HWND — if the pill moves a maximised Electron
 *      window, it would move Chrome / VS Code / anything).
 *   2. Reads its bounds via koffi GetWindowRect.
 *   3. Launches VoiceInk with CDP, which shows the pill.
 *   4. Reads victim bounds again — assert they did NOT shift.
 *   5. Via CDP, triggers the pill's toggle recording (simulating
 *      the shortcut firing).
 *   6. Reads victim bounds again — still unchanged.
 *   7. Triggers toggle again (stop).
 *   8. Final bounds check.
 *
 * Any delta > 3 pixels on any side is treated as a regression — Windows
 * borders and DPI rounding can account for 1–2 px drift.
 */
'use strict';
const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');
const os = require('os');

const INSTALL = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk', 'VoiceInk.exe');
const CDP_PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killAll() {
  // Don't kill electron.exe blindly — VS Code / other Electron apps may
  // be running on the dev box. We only target VoiceInk + our victim.
  for (const n of ['VoiceInk.exe', 'notepad.exe']) {
    try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch {}
  }
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// --- koffi bindings for inspecting HWNDs from Node directly -----------------

const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const GetWindowRect = user32.func('int __stdcall GetWindowRect(void* hWnd, void* lpRect)');
const IsZoomed = user32.func('int __stdcall IsZoomed(void* hWnd)');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void* hWnd)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)');
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void* hWnd)');
const GetWindow = user32.func('void* __stdcall GetWindow(void* hWnd, uint32_t uCmd)');
const GetDesktopWindow = user32.func('void* __stdcall GetDesktopWindow()');
const ShowWindow = user32.func('int __stdcall ShowWindow(void* hWnd, int nCmdShow)');
const GW_CHILD = 5;
const GW_HWNDNEXT = 2;
const SW_MAXIMIZE = 3;

/**
 * Enumerate all top-level HWNDs without relying on EnumWindows (which
 * needs a C callback that koffi's 'register' API can create but is
 * finicky). We walk the desktop window's children via GetWindow/NEXT.
 */
function listTopLevelHwnds() {
  const out = [];
  let h = GetWindow(GetDesktopWindow(), GW_CHILD);
  let guard = 0;
  while (h && koffi.address(h) !== 0n && guard++ < 4000) {
    out.push(h);
    h = GetWindow(h, GW_HWNDNEXT);
  }
  return out;
}

/** Return the first visible top-level HWND whose owning PID matches. */
function findHwndByPid(pid) {
  const pidBuf = Buffer.alloc(4);
  for (const h of listTopLevelHwnds()) {
    if (!IsWindowVisible(h)) continue;
    pidBuf.writeUInt32LE(0, 0);
    GetWindowThreadProcessId(h, pidBuf);
    if (pidBuf.readUInt32LE(0) === pid) return h;
  }
  return null;
}

function getRect(hwnd) {
  const buf = Buffer.alloc(16);
  const ok = GetWindowRect(hwnd, buf);
  if (!ok) return null;
  return {
    left:   buf.readInt32LE(0),
    top:    buf.readInt32LE(4),
    right:  buf.readInt32LE(8),
    bottom: buf.readInt32LE(12),
  };
}
function isMaximised(hwnd) { return IsZoomed(hwnd) !== 0; }

// --- CDP plumbing (same pattern as the other regression scripts) ------------

class CDP {
  constructor(ws) {
    this.ws = new WebSocket(ws); this.id = 0;
    this.pending = new Map(); this.listeners = new Map();
    this.ready = new Promise((ok, err) => {
      this.ws.addEventListener('open', () => ok());
      this.ws.addEventListener('error', (e) => err(e));
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) {
        for (const fn of (this.listeners.get(m.method) || [])) fn(m.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 5000);
    });
  }
}

async function evalJS(cdp, js) {
  const r = await cdp.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(pred, tries, intervalMs = 250) {
  for (let i = 0; i < tries; i++) {
    const v = await pred();
    if (v) return v;
    await sleep(intervalMs);
  }
  return null;
}

// --- victim window ----------------------------------------------------------

/**
 * Spawn notepad.exe as the victim. It's pre-installed on every Windows,
 * has a simple single top-level HWND that matches the spawned PID
 * directly (PowerShell / Electron sometimes wrap behind conhost and
 * the reported PID doesn't own the window — notepad doesn't).
 *
 * notepad doesn't open maximised — we call ShowWindow(SW_MAXIMIZE)
 * from the caller once we've found its HWND.
 */
function spawnVictim() {
  const child = spawn('notepad.exe', [], {
    stdio: 'ignore', detached: true, windowsHide: false,
  });
  child.unref();
  return { pid: child.pid };
}

// --- test flow --------------------------------------------------------------

const issues = [];
function fail(msg) { issues.push(msg); console.log('  [FAIL] ' + msg); }
function ok(msg)   { console.log('  [OK]   ' + msg); }

function rectEqual(a, b, tolerance = 3) {
  if (!a || !b) return false;
  return (
    Math.abs(a.left   - b.left)   <= tolerance &&
    Math.abs(a.top    - b.top)    <= tolerance &&
    Math.abs(a.right  - b.right)  <= tolerance &&
    Math.abs(a.bottom - b.bottom) <= tolerance
  );
}
function rectStr(r) { return r ? `(${r.left},${r.top})-(${r.right},${r.bottom})` : 'null'; }

async function main() {
  console.log('===============================');
  console.log(' FOREGROUND PRESERVATION TEST');
  console.log('===============================');
  killAll();
  await sleep(600);

  // 1. Spawn victim, give it time to maximise. We look up the HWND by
  //    walking top-level windows and matching our child PID (more
  //    reliable than FindWindowW by title, which depends on timing).
  console.log('[1] spawn victim (PowerShell WinForms maximised)');
  const victim = spawnVictim();
  await sleep(2000);
  const vh = await waitFor(() => findHwndByPid(victim.pid), 20, 500);
  if (!vh) {
    console.error(`victim PID ${victim.pid} never produced a top-level HWND`);
    killAll();
    process.exit(2);
  }
  console.log('  victim HWND found at address', koffi.address(vh).toString());

  // Maximise + force-foreground so the test starts from a clean
  // "fullscreen-like" state that any well-behaved app would be in.
  try { ShowWindow(vh, SW_MAXIMIZE); } catch {}
  await sleep(200);
  try { SetForegroundWindow(vh); } catch {}
  await sleep(400);
  const maxOk = isMaximised(vh);
  if (!maxOk) fail(`victim didn't maximise`); else ok(`victim maximised`);

  const r0 = getRect(vh);
  console.log('  victim rect at rest:', rectStr(r0));

  // 2. Launch VoiceInk with CDP.
  console.log('[2] launch VoiceInk (CDP) in compact mode');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VOICEINK_CDP = '1';
  env.VOICEINK_FORCE_DENSITY = 'compact';
  const vi = spawn(INSTALL, [], { stdio: 'ignore', detached: false, env });
  let targets = [];
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    try {
      targets = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
      targets = targets.filter((t) => t.type === 'page' && /compact/.test(t.url));
      if (targets.length) break;
    } catch {}
  }
  if (!targets.length) { console.error('pill never attached via CDP'); killAll(); process.exit(2); }

  // 3. Let the pill finish first paint, then measure again.
  await sleep(1200);
  const r1 = getRect(vh);
  console.log('  victim rect after pill appeared:', rectStr(r1));
  if (!rectEqual(r0, r1)) {
    fail(`pill appearance shifted victim ${rectStr(r0)} → ${rectStr(r1)}`);
  } else {
    ok('pill appearance did NOT disturb victim');
  }

  // 4. Toggle recording via CDP (same path as a shortcut press).
  const cdp = new CDP(targets[0].webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');

  console.log('[3] dispatch Space to pill (= shortcut fire)');
  // The Space keydown targets the pill window via CDP. Even though the
  // pill isn't focused on screen, CDP routes it straight to the renderer,
  // which fires the same toggle() path as the global shortcut IPC.
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(1500);

  const r2 = getRect(vh);
  console.log('  victim rect after shortcut (idle → recording):', rectStr(r2));
  if (!rectEqual(r0, r2)) {
    fail(`shortcut → recording shifted victim ${rectStr(r0)} → ${rectStr(r2)}`);
  } else {
    ok('shortcut → recording did NOT disturb victim');
  }

  // 5. Toggle again — recording → processing/idle.
  console.log('[4] dispatch Space again (= shortcut fire to stop)');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(2200);

  const r3 = getRect(vh);
  console.log('  victim rect after shortcut (recording → idle/processing):', rectStr(r3));
  if (!rectEqual(r0, r3)) {
    fail(`shortcut → stop shifted victim ${rectStr(r0)} → ${rectStr(r3)}`);
  } else {
    ok('shortcut → stop did NOT disturb victim');
  }

  // 6. Also verify the victim is STILL maximised (bug symptom: apps fall
  // out of fullscreen / maximised when the pill takes a Z-order trip).
  const stillMax = isMaximised(vh);
  if (!stillMax) fail('victim lost its maximised state'); else ok('victim still maximised');

  console.log('[5] cleanup');
  killAll();
  try { process.kill(victim.pid); } catch {}
  await sleep(400);

  console.log('\n==============================');
  console.log(issues.length === 0 ? ' ✅ PASS' : ` ❌ FAIL (${issues.length} issue(s))`);
  console.log('==============================');
  process.exit(issues.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[fatal]', e); killAll(); process.exit(2); });
