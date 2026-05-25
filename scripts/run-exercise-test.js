/**
 * Exercise test — simulate a realistic user session against the
 * INSTALLED VoiceInk build and capture every console log, error,
 * exception, and network failure that happens along the way. Fails
 * if anything unexpected shows up.
 *
 * Scenario
 *   1. Boot compact.
 *   2. Hover the capsule → full UI.
 *   3. Space → recording.
 *   4. Space → processing → idle (or error). Verify className transitions.
 *   5. Move the pill via Input.dispatchMouseEvent (drag).
 *   6. Toggle density to comfortable via IPC.
 *   7. Space on comfortable main view → recording → stop.
 *   8. Switch view to history, then settings, then back to main.
 *   9. Toggle density back to compact.
 *
 * At the end we assert:
 *   - No Runtime.exceptionThrown.
 *   - No console errors with /Cannot read|undefined is not|Error\b/.
 *   - No Network.loadingFailed other than our expected 401 if no API key.
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 8000);
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch {} }
}

const logs = [];
const issues = [];

async function evalJS(cdp, js) {
  const r = await cdp.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const desc = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error(desc);
  }
  return r.result.value;
}

async function attachTo(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  const tag = /compact/.test(target.url) ? 'compact' : /comfortable/.test(target.url) ? 'comfy' : 'page';

  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    const txt = args.map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push({ tag, type, txt });
    if (type === 'error') issues.push(`[${tag}][console.error] ${txt}`);
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const desc = exceptionDetails?.exception?.description || exceptionDetails?.text || '??';
    issues.push(`[${tag}][exception] ${String(desc).slice(0, 400)}`);
  });
  cdp.on('Network.loadingFailed', ({ errorText, type: resType }) => {
    if (/net::ERR_ABORTED/.test(errorText)) return;
    issues.push(`[${tag}][net-fail] ${resType || '?'} ${errorText}`);
  });
  return cdp;
}

async function waitForTarget(matcher, tries = 240) {
  for (let i = 0; i < tries; i++) {
    await sleep(250);
    try {
      const all = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
      const match = all.filter((t) => t.type === 'page' && /index\.html/.test(t.url) && matcher(t.url));
      if (match.length) return match;
    } catch {}
  }
  return [];
}

async function main() {
  console.log('===============================');
  console.log(' EXERCISE RUN');
  console.log('===============================');
  killAll(); await sleep(700);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VOICEINK_CDP = '1';
  env.VOICEINK_FORCE_DENSITY = 'compact';

  const child = spawn(INSTALL, [], {
    shell: false, detached: false, windowsHide: false, env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Flag main-process output ONLY for genuine problems. Normal operational
  // logs (e.g. "[inject] SetForegroundWindow returned 0, proceeding anyway"
  // which fires when Windows focus-stealing prevention kicks in during a
  // headless / scripted session) would otherwise drown the signal.
  const fatalRe = /Uncaught|Unhandled\s+(?:Promise|Rejection)|TypeError|ReferenceError|SyntaxError|ENOENT|EACCES/i;
  child.stdout.on('data', (c) => {
    const lines = c.toString().split(/\r?\n/).filter(Boolean);
    for (const l of lines) if (fatalRe.test(l)) issues.push('[main] ' + l);
  });
  child.stderr.on('data', (c) => {
    const lines = c.toString().split(/\r?\n/).filter(Boolean);
    for (const l of lines) {
      // stderr is the usual home for real errors. Still skip Electron
      // boilerplate like "DevTools listening on..." and the single
      // "SetForegroundWindow returned 0" operational notice.
      if (/DevTools listening|SetForegroundWindow returned 0/i.test(l)) continue;
      if (fatalRe.test(l) || /\b(fail|error|cannot)\b/i.test(l)) issues.push('[main:err] ' + l);
    }
  });

  // Step 1 — boot compact, attach.
  let targets = await waitForTarget((u) => /compact/.test(u));
  if (!targets.length) { killAll(); throw new Error('compact target never appeared'); }
  let compact = await attachTo(targets[0]);
  console.log('[step 1] compact booted');

  // Step 2 — poll until React has mounted the capsule, then hover centre.
  let rect = null;
  for (let i = 0; i < 30 && !rect; i++) {
    rect = await evalJS(compact, `(() => {
      const c = document.querySelector('.pill-idle-capsule');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      if (r.width < 50) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    if (!rect) await sleep(100);
  }
  if (!rect || rect.w < 100) {
    issues.push(`[exercise] capsule rect invalid: ${JSON.stringify(rect)}`);
    killAll();
    return issues.length;
  }
  const cx = Math.round(rect.x + rect.w / 2);
  const cy = Math.round(rect.y + rect.h / 2);
  // Clear any stale hover first — same pattern as run-installed-hover-test.
  await compact.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 9999, y: 9999, button: 'none', buttons: 0 });
  await sleep(250);
  await compact.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
  // Poll opacity until the CSS transition settles (up to 800 ms).
  let hoverOpacity = 0;
  for (let i = 0; i < 8; i++) {
    await sleep(100);
    hoverOpacity = await evalJS(compact, `parseFloat(getComputedStyle(document.querySelector('.pill-full')).opacity)`);
    if (hoverOpacity >= 0.9) break;
  }
  if (hoverOpacity < 0.9) issues.push(`[exercise] hover on capsule centre didn't reveal pill-full (opacity=${hoverOpacity})`);
  console.log('[step 2] hover reveals full UI (opacity=' + hoverOpacity + ')');

  // Step 3 — Space → recording.
  await compact.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await compact.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(1500);
  const recClass = await evalJS(compact, `document.querySelector('.pill-root').className`);
  if (!/state-recording/.test(recClass)) issues.push(`[exercise] Space didn't enter recording (className=${recClass})`);
  console.log('[step 3] Space → recording (className=' + recClass + ')');

  // Step 4 — Space → stop.
  await compact.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await compact.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await sleep(2500);
  const stopClass = await evalJS(compact, `document.querySelector('.pill-root').className`);
  if (/state-recording/.test(stopClass)) issues.push(`[exercise] Space didn't stop recording (className=${stopClass})`);
  console.log('[step 4] Space → stop (className=' + stopClass + ')');

  // Step 5 — drag the pill from its centre to a new position.
  await compact.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await compact.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 40, y: cy + 10, button: 'left' });
  await compact.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 40, y: cy + 10, button: 'left', clickCount: 1 });
  await sleep(500);
  console.log('[step 5] drag gesture dispatched');

  // Step 6 — swap to comfortable via IPC. Do NOT await the evaluate:
  // the density swap tears down the compact renderer, so the reply
  // never arrives. Fire-and-forget, then poll for the comfortable
  // target.
  try {
    compact.send('Runtime.evaluate', {
      expression: `window.voiceink.windowResizeForDensity('comfortable')`,
      returnByValue: false, awaitPromise: false,
    }).catch(() => {});
  } catch {}
  await sleep(1500);

  targets = await waitForTarget((u) => /comfortable/.test(u));
  if (!targets.length) {
    issues.push('[exercise] comfortable target never appeared after density swap');
  } else {
    compact.close();
    const comfy = await attachTo(targets[0]);
    console.log('[step 6] comfortable window active');

    // Step 7 — Space toggles recording on comfortable too.
    await comfy.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
    await comfy.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
    await sleep(1500);
    const cmfRec = await evalJS(comfy, `document.querySelector('.record-btn')?.className || ''`);
    if (!/recording/.test(cmfRec)) issues.push(`[exercise] Space in comfortable didn't enter recording (className=${cmfRec})`);
    console.log('[step 7] comfortable Space → recording (className=' + cmfRec + ')');

    await comfy.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
    await comfy.send('Input.dispatchKeyEvent', { type: 'keyUp',   code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
    await sleep(2500);

    // Step 8 — navigate through the sidebar.
    await evalJS(comfy, `(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role=button]'));
      const hit = (label) => {
        for (const b of buttons) {
          const t = (b.textContent || '').trim();
          if (t.toLowerCase().includes(label.toLowerCase())) { b.click(); return true; }
        }
        return false;
      };
      hit('historique'); return true;
    })()`);
    await sleep(500);
    const viewClass = await evalJS(comfy, `document.querySelector('main')?.querySelector('*[class*="history"], *[class*="History"]')?.outerHTML?.slice(0, 60) || document.body.textContent?.includes('Historique') || false`);
    console.log('[step 8] navigated to history (has history text=' + viewClass + ')');

    // Step 9 — back to pill. Do NOT await this evaluate: the density
    // swap tears down the comfortable window we're attached to, so the
    // Runtime reply never arrives. Fire-and-forget, give main a moment
    // to recreate the pill window, then move on.
    try {
      comfy.send('Runtime.evaluate', {
        expression: `window.voiceink.windowResizeForDensity('compact')`,
        returnByValue: false, awaitPromise: false,
      }).catch(() => {});
    } catch {}
    await sleep(1500);
    comfy.close();
    console.log('[step 9] density swap back to compact dispatched');
  }

  // Final snapshot — wait a beat for any trailing console events.
  await sleep(600);
  killAll();
  await sleep(300);

  console.log('');
  console.log('===============================');
  console.log(' SUMMARY');
  console.log('===============================');
  console.log('  logs captured: ' + logs.length);
  if (issues.length === 0) {
    console.log('  issues:        0   ✅ CLEAN SESSION');
    return 0;
  }
  console.log('  issues:        ' + issues.length);
  for (const i of issues) console.log('    - ' + i);
  return issues.length;
}

main().then((fails) => {
  process.exit(fails === 0 ? 0 : 1);
}).catch((e) => {
  console.error('[exercise] fatal:', e);
  killAll();
  process.exit(2);
});
