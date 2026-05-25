/**
 * Regression test that runs against the ACTUAL INSTALLED VoiceInk.exe,
 * not the dev loopback.
 *
 * Current UX contract — "Superwhisper-style wide-pill hover":
 *   - The black pill indicator is ~140×26 px, centred in the 176×55
 *     window. Hovering ANY pixel of the VISIBLE pill expands the UI.
 *   - The ~18 px transparent margin left/right + ~14 px top/bottom
 *     of the window are INERT — hovering them does nothing.
 *   - Once expanded, hovering the `.pill-full` UI (the mic + expand
 *     buttons that are now visible) must KEEP it expanded so the
 *     user can actually click them — retention is the
 *     `:has(.pill-full:hover)` sibling rule in index.css.
 *   - Leaving the window collapses back to the retracted pill.
 *
 * We discover the capsule rect at runtime via getBoundingClientRect
 * so the probes survive future resize tweaks without edits.
 *
 * VOICEINK_FORCE_DENSITY=compact forces a 176×55 pill regardless of
 * the persisted `density` — that also exercises the density-pinning
 * fix in useStore.
 */
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

(async () => {
  const runs = parseInt(process.argv[2] || '1', 10);
  let totalFail = 0;

  for (let r = 1; r <= runs; r++) {
    console.log('===============================');
    console.log(' INSTALLED RUN ' + r + ' / ' + runs);
    console.log('===============================');
    killAll(); await sleep(600);

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.VOICEINK_CDP = '1';
    env.VOICEINK_FORCE_DENSITY = 'compact';

    const child = spawn(INSTALL, [], {
      shell: false, detached: false, windowsHide: false, env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {});   // silence app stdout
    child.stderr.on('data', () => {});

    let targets = [];
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      try {
        targets = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
        targets = targets.filter((t) => t.type === 'page' && /index\.html/.test(t.url));
        if (targets.length) break;
      } catch {}
    }
    if (!targets.length) { console.error('CDP never came up'); totalFail++; continue; }

    const tgt = targets.find((t) => /compact/.test(t.url)) || targets[0];
    console.log('attached:', tgt.url);
    const cdp = new CDP(tgt.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      const txt = args.map((a) => a.value ?? a.description ?? '').join(' ');
      console.log('  [console ' + type + '] ' + txt);
    });

    // Wait for first render + capsule to exist
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const ok = await evalJS(cdp, `!!document.querySelector('.pill-idle-capsule')`);
      if (ok) break;
    }

    // Geometry
    const geom = await evalJS(cdp, `(() => {
      const v = { w: innerWidth, h: innerHeight };
      const r = document.querySelector('.pill-idle-capsule').getBoundingClientRect();
      return { v, cap: { x: r.x + r.width/2, y: r.y + r.height/2, halfW: r.width/2, halfH: r.height/2 } };
    })()`);
    console.log('viewport:', geom.v.w + '×' + geom.v.h, ' capsule centre:', Math.round(geom.cap.x) + ',' + Math.round(geom.cap.y));

    async function moveTo(x, y) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    }
    /**
     * Fully drop any :hover state before the next probe. Simply
     * moving to (-10, -10) is unreliable — Chromium may clamp the
     * x/y to the viewport, keeping :hover on whatever element was
     * under (0, 0). We use a large off-screen coordinate instead
     * (Chromium honours it and reports no elementFromPoint hit),
     * and wait a transition worth of time for the CSS fade-out.
     */
    async function clearHover() {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: 9000, y: 9000, button: 'none', buttons: 0,
      });
      await sleep(350);
    }
    async function snap() {
      return evalJS(cdp, `(() => {
        const full = document.querySelector('.pill-full');
        const cap  = document.querySelector('.pill-idle-capsule');
        return {
          fullOp: parseFloat(getComputedStyle(full).opacity).toFixed(2),
          capOp:  parseFloat(getComputedStyle(cap).opacity).toFixed(2),
          hasCapHover: !!document.querySelector('.pill-idle-capsule:hover'),
          hasFullHover: !!document.querySelector('.pill-full:hover'),
          hasFaceHover: !!document.querySelector('.pill-idle-face:hover'),
        };
      })()`);
    }

    // Superwhisper-style wide pill: the capsule rect is measured at
    // runtime, so probe coordinates are derived from geom.cap and stay
    // correct no matter what size the capsule takes in future tweaks.
    const cx = geom.cap.x, cy = geom.cap.y;
    const hW = geom.cap.halfW, hH = geom.cap.halfH;
    const M_IN = 3;   // margin inside capsule edge (px)
    const M_OUT = 3;  // margin outside capsule edge (px)
    const probes = [
      // --- INSIDE THE VISIBLE PILL → must expand ---
      { name: 'pill-centre',         x: cx,              y: cy,              expect: 'expand' },
      { name: 'pill-inner-left',     x: cx - hW + M_IN,  y: cy,              expect: 'expand' },
      { name: 'pill-inner-right',    x: cx + hW - M_IN,  y: cy,              expect: 'expand' },
      { name: 'pill-inner-top',      x: cx,              y: cy - hH + M_IN,  expect: 'expand' },
      { name: 'pill-inner-bottom',   x: cx,              y: cy + hH - M_IN,  expect: 'expand' },
      // --- OUTSIDE THE VISIBLE PILL → must retract ---
      { name: 'outside-left',        x: cx - hW - M_OUT, y: cy,              expect: 'retract' },
      { name: 'outside-right',       x: cx + hW + M_OUT, y: cy,              expect: 'retract' },
      { name: 'outside-top',         x: cx,              y: cy - hH - M_OUT, expect: 'retract' },
      { name: 'outside-bottom',      x: cx,              y: cy + hH + M_OUT, expect: 'retract' },
      { name: 'top-left-corner',     x: 4,               y: 4,               expect: 'retract' },
      { name: 'top-right-corner',    x: geom.v.w - 4,    y: 4,               expect: 'retract' },
      { name: 'bottom-left-corner',  x: 4,               y: geom.v.h - 4,    expect: 'retract' },
      { name: 'bottom-right-corner', x: geom.v.w - 4,    y: geom.v.h - 4,    expect: 'retract' },
    ];

    let failed = 0;
    for (const p of probes) {
      await clearHover();
      await moveTo(p.x, p.y); await sleep(280);
      const s = await snap();
      const expanded = parseFloat(s.fullOp) > 0.5;
      const ok = (p.expect === 'expand') ? expanded : !expanded;
      console.log('  ' + (ok ? 'OK ' : 'FAIL') + '  ' + p.name.padEnd(22) +
        ' (' + Math.round(p.x) + ',' + Math.round(p.y) + ')  fullOp=' + s.fullOp +
        ' capOp=' + s.capOp);
      if (!ok) failed++;
    }

    // Retention sweep: land on the capsule, then slide to points that
    // are OUTSIDE the 140-wide capsule but INSIDE the surrounding
    // .pill-full (which covers the full 176-wide pill rect once the
    // pill has expanded). Both must keep fullOp at 1 — that's the
    // whole purpose of the `:has(.pill-full:hover)` retention rule,
    // so the user can reach the mic and expand buttons that sit past
    // the capsule edges.
    await clearHover();
    await moveTo(cx, cy);  await sleep(260);
    const leftProbe = 10; // well inside pill-full, ~8 px outside capsule
    await moveTo(leftProbe, cy); await sleep(240);
    const atMic = await snap();
    const retainMicOK = parseFloat(atMic.fullOp) > 0.5;
    console.log('  ' + (retainMicOK ? 'OK ' : 'FAIL') + '  retention-mic          (' + leftProbe + ',' + Math.round(cy) + ')  fullOp=' + atMic.fullOp);
    if (!retainMicOK) failed++;

    const rightProbe = geom.v.w - 10;
    await moveTo(rightProbe, cy); await sleep(240);
    const atExpand = await snap();
    const retainExpandOK = parseFloat(atExpand.fullOp) > 0.5;
    console.log('  ' + (retainExpandOK ? 'OK ' : 'FAIL') + '  retention-expand       (' + rightProbe + ',' + Math.round(cy) + ')  fullOp=' + atExpand.fullOp);
    if (!retainExpandOK) failed++;

    // Collapse
    await clearHover();
    const collapsed = await snap();
    const collapseOK = parseFloat(collapsed.fullOp) < 0.05;
    console.log('  ' + (collapseOK ? 'OK ' : 'FAIL') + '  leave-pill-area        fullOp=' + collapsed.fullOp);
    if (!collapseOK) failed++;

    const totalChecks = probes.length + 3; // + retention-mic, retention-expand, collapse
    console.log(failed === 0 ? '\n✅ PASS (' + totalChecks + ' probes + retention + collapse)\n'
                             : '\n❌ FAIL: ' + failed + ' of ' + totalChecks + ' check(s)\n');
    totalFail += failed;

    try { cdp.ws.close(); } catch {}
    try { process.kill(child.pid); } catch {}
    await sleep(400);
  }

  killAll();
  console.log(totalFail === 0
    ? '=== ALL ' + runs + ' INSTALLED RUN(S) PASSED ==='
    : '=== ' + totalFail + ' FAIL(s) across ' + runs + ' run(s) ===');
  process.exit(totalFail === 0 ? 0 : 1);
})().catch((e) => { console.error('fatal:', e); killAll(); process.exit(3); });
