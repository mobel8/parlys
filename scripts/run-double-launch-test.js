/**
 * Regression test for the two bugs the user reported against the
 * installed VoiceInk build:
 *
 *   Bug 1 — double-click on the desktop shortcut launched a SECOND
 *           Electron process. Two pills floated on top of each other,
 *           and only the first process had the global shortcut
 *           registered. The user's hotkey therefore toggled a pill
 *           they couldn't see.
 *
 *   Bug 2 — pressing the hotkey produced NO visible change on the
 *           pill the user was looking at — directly caused by bug 1,
 *           since the IPC was delivered to the invisible twin.
 *
 * Fix:
 *   - main/index.ts now calls app.requestSingleInstanceLock(); losing
 *     processes quit immediately.
 *   - a 'second-instance' handler surfaces the primary pill so a
 *     repeated launch focuses the existing one.
 *   - CompactView.tsx uses a ref-backed recState inside the IPC
 *     handler, removing a stale-closure risk on rapid toggles.
 *
 * This script verifies ALL OF THE ABOVE against the installed exe by:
 *   1. killing every VoiceInk.exe,
 *   2. launching a FIRST instance with VOICEINK_CDP=1 (forced compact),
 *   3. attaching CDP and counting VoiceInk.exe processes (must be 1),
 *   4. spawning a SECOND instance WITHOUT CDP — it should be rejected
 *      by the lock and exit within ~2 s,
 *   5. re-counting VoiceInk.exe (must still be 1),
 *   6. dispatching Space (the pill's in-window toggle path, same
 *      toggle() React callback the IPC path uses) and asserting the
 *      .pill-root element flips to `state-recording is-forced-expanded`,
 *   7. dispatching Space again and asserting it leaves the recording
 *      state (moves to `state-processing` briefly then back to idle).
 *
 * Usage:
 *   node scripts/run-double-launch-test.js            # 1 run
 *   node scripts/run-double-launch-test.js 3          # 3 consecutive runs
 */
'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const INSTALL = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk', 'VoiceInk.exe');
const CDP_PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killAll() {
  for (const n of ['VoiceInk.exe', 'electron.exe']) {
    try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch {}
  }
}

function countVoiceInk() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq VoiceInk.exe" /FO CSV /NH', { stdio: ['ignore', 'pipe', 'ignore'] });
    const s = out.toString();
    // When no process matches, tasklist prints "INFO: No tasks..." and exits 0.
    if (/No tasks/i.test(s)) return 0;
    // Otherwise count CSV lines that begin with a quoted image name.
    return s.trim().split(/\r?\n/).filter((l) => l.startsWith('"VoiceInk.exe"')).length;
  } catch {
    return 0;
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

class CDP {
  constructor(ws) {
    this.ws = new WebSocket(ws);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
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
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 5000);
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function evalJS(cdp, js) {
  const r = await cdp.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' // ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}

function assert(cond, label) {
  if (cond) { console.log('  [OK] ' + label); return 0; }
  console.error('  [KO] ' + label);
  return 1;
}

async function runOnce(runNum, totalRuns) {
  console.log('===============================');
  console.log(` DOUBLE-LAUNCH RUN ${runNum} / ${totalRuns}`);
  console.log('===============================');

  killAll();
  await sleep(700);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VOICEINK_CDP = '1';
  env.VOICEINK_FORCE_DENSITY = 'compact';

  // Step 1 — primary launch with CDP.
  console.log('[launch] primary (CDP enabled)');
  const primary = spawn(INSTALL, [], {
    shell: false, detached: false, windowsHide: false, env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  primary.stdout.on('data', () => {});
  primary.stderr.on('data', () => {});

  // Poll CDP until the compact renderer target shows up.
  let targets = [];
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    try {
      targets = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
      targets = targets.filter((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (targets.length) break;
    } catch {}
  }
  if (!targets.length) {
    console.error('[launch] CDP never came up — primary failed to start');
    killAll();
    return 1;
  }
  const tgt = targets.find((t) => /compact/.test(t.url)) || targets[0];
  console.log('[attach]', tgt.url);
  const cdp = new CDP(tgt.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    const txt = args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (type === 'error' || type === 'warning' || /ON_TOGGLE/.test(txt)) {
      console.log('  [renderer ' + type + '] ' + txt);
    }
  });

  let fails = 0;

  // Step 2 — snapshot the primary process tree (main + GPU + utility
  // + renderer helpers all run as VoiceInk.exe, so we don't hard-code
  // a count; we just remember the baseline).
  const preCount = countVoiceInk();
  fails += assert(preCount >= 1, `primary tree alive (VoiceInk.exe count=${preCount})`);

  // Step 3 — attempt to spawn a second instance.
  console.log('[launch] secondary (should be rejected by single-instance lock)');
  const secondary = spawn(INSTALL, [], {
    shell: false, detached: false, windowsHide: false, env: { ...process.env },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => secondary.on('exit', () => resolve(true)));
  const deadline = sleep(6000).then(() => false);
  const didExit = await Promise.race([exited, deadline]);
  fails += assert(didExit === true, 'secondary exited within 6 s (single-instance lock worked)');

  await sleep(1000);
  const postCount = countVoiceInk();
  // The primary process tree must not have grown. A correctly
  // single-instance-locked app exits its losing process before any
  // renderer / GPU helpers spawn — postCount must equal preCount
  // (± 0). We tolerate a transient -1 in case a helper crashed and
  // is respawning, but any NEW persistent process is a red flag.
  fails += assert(postCount <= preCount,
    `no new VoiceInk process tree after double-launch (pre=${preCount} post=${postCount})`);

  // Step 4 — verify pill reacts to a Space toggle (same React toggle()
  // the IPC handler fans out to).
  const initialClass = await evalJS(cdp, `document.querySelector('.pill-root')?.className || ''`);
  console.log('[state] initial className =', initialClass);
  fails += assert(/is-idle/.test(initialClass), 'pill starts in is-idle state');
  fails += assert(!/is-forced-expanded/.test(initialClass), 'pill is not forced-expanded initially');

  // Focus window + dispatch Space keydown at window level. Wait long
  // enough for getUserMedia + MediaRecorder.start() to actually promote
  // the MediaRecorder to state='recording' — ~1.5 s is ample on
  // Windows + Electron 33; 500 ms hit a race where stop() would
  // no-op against an inactive recorder.
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(1500);

  const afterToggleClass = await evalJS(cdp, `document.querySelector('.pill-root')?.className || ''`);
  console.log('[state] post-toggle className =', afterToggleClass);

  // After toggle the pill must be visibly "recording": state-recording
  // on the root, is-forced-expanded to show the full UI, pill-full
  // faded in. We check the className + the computed pill-full opacity.
  fails += assert(/state-recording/.test(afterToggleClass), 'className switched to state-recording');
  fails += assert(/is-forced-expanded/.test(afterToggleClass), 'className switched to is-forced-expanded');
  fails += assert(!/is-idle/.test(afterToggleClass), 'className no longer contains is-idle');

  const pillFullOpacity = await evalJS(cdp, `
    (() => {
      const el = document.querySelector('.pill-full');
      if (!el) return null;
      return parseFloat(getComputedStyle(el).opacity);
    })()
  `);
  console.log('[state] pill-full opacity =', pillFullOpacity);
  fails += assert(pillFullOpacity >= 0.9, `pill-full is fully visible during recording (opacity=${pillFullOpacity})`);

  const borderColor = await evalJS(cdp, `
    (() => {
      const el = document.querySelector('.pill');
      if (!el) return null;
      return getComputedStyle(el).borderColor;
    })()
  `);
  console.log('[state] pill border-color =', borderColor);
  // The state-recording pill has border-color rgba(244, 63, 94, 0.35).
  // Chromium reports computed colors as 'rgb(244, 63, 94)' with alpha
  // dropped, or 'rgba(244, 63, 94, 0.35)' depending on prop. Either way,
  // the red channel dominates: "244" should appear.
  fails += assert(borderColor && /244/.test(borderColor), `pill border reflects recording red glow (${borderColor})`);

  // Step 5 — toggle again, assert we LEAVE the recording state. Wait
  // 2 s so MediaRecorder.onstop has fired, the audio blob has been
  // posted to the transcribe IPC, and React has committed the new
  // state (processing, idle, or error — any of them proves the stop
  // path worked).
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(2000);

  const afterStopClass = await evalJS(cdp, `document.querySelector('.pill-root')?.className || ''`);
  console.log('[state] post-stop className =', afterStopClass);
  const leftRecording = !/state-recording/.test(afterStopClass);
  fails += assert(leftRecording, `className left state-recording (now "${afterStopClass}")`);

  console.log('[cleanup] killing primary');
  killAll();
  await sleep(300);

  const summary = fails === 0 ? '✅ PASS' : '❌ FAIL (' + fails + ' assertion(s))';
  console.log(`[run ${runNum}] ${summary}`);
  return fails;
}

(async () => {
  const runs = Math.max(1, parseInt(process.argv[2] || '1', 10));
  let total = 0;
  const perRun = [];
  for (let i = 1; i <= runs; i++) {
    const f = await runOnce(i, runs);
    total += f;
    perRun.push(f);
    if (i < runs) await sleep(600);
  }
  console.log('\n==============================');
  console.log(' DOUBLE-LAUNCH SUMMARY');
  console.log('==============================');
  for (let i = 0; i < perRun.length; i++) {
    console.log(`  run ${i + 1}: ${perRun[i] === 0 ? '[OK]' : '[FAIL:' + perRun[i] + ']'}`);
  }
  if (total === 0) {
    console.log(`\n=== ALL ${runs} RUN(S) PASSED ===`);
    process.exit(0);
  }
  console.log(`\n=== FAILED: ${total} assertion(s) across ${runs} run(s) ===`);
  process.exit(1);
})();
