/**
 * End-to-end regression test for the compact pill hover oscillation.
 *
 *  1. Launch Electron with VOICEINK_PILL_SAMPLER=1.
 *  2. Wait until the pill window is visible.
 *  3. Park the real cursor on the pill centre for 3 s.
 *  4. Parse the sampler lines from runtime.log.
 *  5. Kill Electron and report PASS/FAIL.
 *
 * Usage:  node scripts/run-hover-test.js
 */
const { spawn, execSync } = require('child_process');
const koffi = require('koffi');
const fs = require('fs');
const path = require('path');

const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('RECT', {
  left: 'int32', top: 'int32', right: 'int32', bottom: 'int32',
});
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32',
  time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const INPUT = koffi.struct('INPUT', {
  type: 'uint32', _pad: 'uint32', mi: MOUSEINPUT,
  _tail: koffi.array('uint8', 8),
});

const FindWindowA     = user32.func('void* FindWindowA(const char*, const char*)');
const GetWindowRect   = user32.func('bool GetWindowRect(void*, _Out_ RECT*)');
const SetCursorPos    = user32.func('bool SetCursorPos(int32, int32)');
const SendInput       = user32.func('uint32 SendInput(uint32, INPUT*, int32)');
const GetSystemMetrics = user32.func('int32 GetSystemMetrics(int32)');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(void*)');

const MOUSEEVENTF_MOVE     = 0x0001;
const MOUSEEVENTF_ABSOLUTE = 0x8000;

function realMouseMove(x, y) {
  const w = GetSystemMetrics(0); // SM_CXSCREEN
  const h = GetSystemMetrics(1); // SM_CYSCREEN
  const input = {
    type: 0, // INPUT_MOUSE
    _pad: 0,
    mi: {
      dx: Math.round((x * 65535) / w),
      dy: Math.round((y * 65535) / h),
      mouseData: 0,
      dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
      time: 0,
      dwExtraInfo: 0,
    },
    _tail: new Uint8Array(8),
  };
  SendInput(1, [input], koffi.sizeof(INPUT));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, 'runtime.log');

function killElectron() {
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /F /IM VoiceInk.exe', { stdio: 'ignore' }); } catch {}
}

async function waitForWindow(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hwnd = FindWindowA(null, 'VoiceInk');
    if (hwnd) {
      const r = {};
      if (
        GetWindowRect(hwnd, r) &&
        r.right > r.left && r.bottom > r.top &&
        // Reject the pre-show hidden rect that Electron uses (≈ -25600).
        r.left > -10000 && r.top > -10000
      ) {
        return { hwnd, r };
      }
    }
    await sleep(250);
  }
  return null;
}

async function main() {
  killElectron();
  // Truncate the log so we only read samples from this run.
  try { fs.writeFileSync(LOG, ''); } catch {}

  const env = { ...process.env,
    VOICEINK_PILL_SAMPLER: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  };
  // The parent shell may have ELECTRON_RUN_AS_NODE=1 left over from a
  // previous run — if so the Electron binary behaves like plain Node
  // and crashes on `app.isPackaged`. Force it off.
  delete env.ELECTRON_RUN_AS_NODE;
  const logFd = fs.openSync(LOG, 'a');
  const child = spawn(
    'npx electron .',
    { cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: false, windowsHide: false, shell: true },
  );
  child.on('error', (e) => { console.error('spawn error:', e); });

  console.log('Waiting for VoiceInk window…');
  const found = await waitForWindow();
  if (!found) {
    killElectron();
    console.error('FAIL: pill window never appeared within 15 s');
    process.exit(2);
  }
  const { hwnd, r } = found;
  const cx = r.left + Math.floor((r.right - r.left) / 2);
  const cy = r.top + Math.floor((r.bottom - r.top) / 2);
  console.log('Window rect:', r, '→ centre:', cx, cy);

  // Raise the window so it actually receives mouse events.
  SetForegroundWindow(hwnd);
  // Warm-up: let React paint a few frames before we start asserting.
  await sleep(500);

  const startSize = fs.statSync(LOG).size;

  // Approach smoothly then park dead-centre for 3 s. Each move must be
  // a REAL SendInput-generated mouse event so Chromium emits mouseover
  // and updates :hover; bare SetCursorPos is cosmetic only.
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    realMouseMove(cx + (steps - i) * 18, cy);
    await sleep(40);
  }
  realMouseMove(cx, cy);
  await sleep(3000);

  // Parse sampler lines emitted during the hover window.
  const tail = fs.readFileSync(LOG, 'utf8').slice(startSize);
  const samples = tail
    .split(/\r?\n/)
    .filter((l) => l.includes('[pill-sampler]'));

  killElectron();

  if (samples.length === 0) {
    console.error('FAIL: no sampler output. Was VOICEINK_PILL_SAMPLER picked up?');
    process.exit(3);
  }

  const parsed = samples.map((l) => ({
    w: Number((l.match(/w=([0-9.]+)/) || [])[1]),
    hover: /hover=true/.test(l),
    glass: /glass=true/.test(l),
  })).filter((p) => Number.isFinite(p.w));

  const widths = parsed.map((p) => Math.round(p.w));
  const hovers = parsed.map((p) => (p.hover ? 1 : 0));
  const glasses = parsed.map((p) => (p.glass ? 1 : 0));
  console.log('widths :', widths.join(','));
  console.log('hovers :', hovers.join(''));
  console.log('glasses:', glasses.join(''));

  const last20 = widths.slice(-20);
  const last20Glass = glasses.slice(-20);
  const maxW = Math.max(...last20);
  const minW = Math.min(...last20);
  // Stability is defined in terms of the real rendered state — the
  // hover query can miss when Chromium de-syncs `matches(':hover')`
  // from the paint evaluation of :hover CSS, but the background
  // gradient never lies.
  const stable = last20Glass.every((g) => g === 1) && (maxW - minW) < 4;
  const expanded = maxW >= 140;

  if (stable && expanded) {
    console.log(`PASS: hover stable (width ${minW}-${maxW}, all 20 samples hovered)`);
    process.exit(0);
  }
  console.error(`FAIL: stable=${stable} expanded=${expanded} min=${minW} max=${maxW}`);
  process.exit(1);
}

main().catch((e) => { killElectron(); console.error(e); process.exit(99); });
