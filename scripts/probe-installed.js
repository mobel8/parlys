/**
 * Probe the INSTALLED VoiceInk.exe via CDP (not the dev launch).
 *
 * Starts the installed binary with VOICEINK_CDP=1 so a CDP server comes
 * up on :9222, attaches to the pill page, and reports — in this order:
 *
 *   1. Viewport + geometry of the pill's .pill / .pill-idle-capsule /
 *      .pill-full bounding boxes, so we can see they're laid out as
 *      expected.
 *   2. getComputedStyle(capsule) for z-index, opacity, pointer-events,
 *      app-region, and the same for .pill-idle-face and .pill-full.
 *   3. What `document.elementFromPoint(x, y)` returns at 3 probe
 *      points: capsule centre, halo left (just outside capsule), and
 *      the mic button position.
 *   4. Live hit test after dispatching Input.dispatchMouseEvent via
 *      CDP — so we mimic what a real user does and see whether the
 *      hover class list flips or not.
 *
 * Prints everything and exits. No restart, no killing other windows —
 * we want to see what the USER is seeing.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const CDP_PORT = 9222;
const INSTALL  = path.join(
  process.env.LOCALAPPDATA,
  'Programs', 'VoiceInk', 'VoiceInk.exe',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killAll() {
  try { execSync('taskkill /F /IM VoiceInk.exe',  { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /F /IM electron.exe',  { stdio: 'ignore' }); } catch {}
}
function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
    });
    this.ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : ev.data.toString();
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const subs = this.listeners.get(msg.method) || [];
        for (const fn of subs) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); }
      }, 5000);
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function evalExpr(cdp, expr) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' // ' + (exceptionDetails.exception && exceptionDetails.exception.description));
  return result.value;
}

(async () => {
  console.log('[probe] killing VoiceInk …');
  killAll();
  await sleep(800);

  console.log('[probe] launching', INSTALL, 'with CDP=1 …');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;                // sabotages Electron entry point
  env.VOICEINK_CDP = '1';
  // Force compact so we reproduce the exact bug: persisted settings
  // say 'comfortable' but main creates a 176×55 pill. Pre-fix, React
  // replaced the CompactView with MainView inside the pill on first
  // loadSettings(). Post-fix, density is pinned to the URL hash and
  // the CompactView stays mounted.
  env.VOICEINK_FORCE_DENSITY = 'compact';
  env.ELECTRON_ENABLE_LOGGING = '1';

  const child = spawn(INSTALL, [], {
    shell: false,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    env,
  });
  child.stdout.on('data', (b) => process.stdout.write('  [app.out] ' + b));
  child.stderr.on('data', (b) => process.stdout.write('  [app.err] ' + b));
  child.on('exit', (c) => console.log('[probe] VoiceInk.exe exited with', c));

  let targets = [];
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    try {
      targets = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
      targets = targets.filter((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (targets.length) break;
    } catch (e) {
      if (i % 8 === 0) console.log('[probe] CDP still not up … (' + ((i + 1) * 0.25).toFixed(1) + ' s)');
    }
  }
  if (!targets.length) {
    console.error('[probe] no pill target on :9222 after 60 s — is CDP enabled?');
    try { process.kill(child.pid); } catch {}
    process.exit(2);
  }

  // Prefer the #compact page if multiple targets are up.
  targets.sort((a, b) => (/compact/.test(b.url) - /compact/.test(a.url)));
  const tgt = targets[0];
  console.log('[probe] attached:', tgt.url);

  // Show EVERY CDP target so we can tell pill/comfort pages apart.
  console.log('[probe] targets seen:');
  for (const t of targets) console.log('   -', t.type, t.title || '-', t.url);

  const cdp = new CDP(tgt.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  // Dump the outer HTML of #root so we can SEE which component React
  // actually mounted. Trim long className strings for readability.
  const html = await evalExpr(cdp, `(() => {
    const r = document.getElementById('root');
    if (!r) return '<no #root>';
    return r.outerHTML.replace(/class="([^"]{0,120})[^"]*"/g, 'class="$1…"').slice(0, 1400);
  })()`);
  console.log('\n[probe] #root outerHTML (truncated):');
  console.log('  ' + html.split('\n').join('\n  '));

  // Console relay
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    const txt = args.map((a) => a.value ?? a.description ?? '').join(' ');
    console.log('  [renderer ' + type + '] ' + txt);
  });

  // 1. geometry
  const geom = await evalExpr(cdp, `(() => {
    const pick = (s) => { const el = document.querySelector(s); if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return { rect: { x:r.x, y:r.y, w:r.width, h:r.height },
               zIndex: cs.zIndex, opacity: cs.opacity,
               pointerEvents: cs.pointerEvents,
               appRegion: cs.getPropertyValue('-webkit-app-region') || cs.webkitAppRegion };
    };
    return { dpr: devicePixelRatio,
             view: { w: innerWidth, h: innerHeight },
             pill: pick('.pill'),
             idleFace: pick('.pill-idle-face'),
             capsule: pick('.pill-idle-capsule'),
             full: pick('.pill-full'),
             mic: pick('.pill-mic'),
             expand: pick('.pill-expand'),
             rootClass: document.querySelector('.pill-root')?.className || '',
             htmlDataDensity: document.documentElement.getAttribute('data-density'),
           };
  })()`);
  console.log('\n[probe] viewport', geom.view, ' dpr=', geom.dpr);
  console.log('[probe] root classes :', geom.rootClass);
  console.log('[probe] html data-density:', geom.htmlDataDensity);
  for (const key of ['pill','idleFace','capsule','full','mic','expand']) {
    const g = geom[key];
    if (!g) { console.log('  ' + key.padEnd(10) + '  <missing>'); continue; }
    console.log('  ' + key.padEnd(10) +
      '  rect=' + JSON.stringify(g.rect) +
      '  z=' + g.zIndex + '  op=' + g.opacity +
      '  pe=' + g.pointerEvents + '  drag=' + g.appRegion);
  }

  // 2. elementFromPoint at key probes
  const probes = [
    { name: 'capsule-centre', x: geom.view.w / 2, y: geom.view.h / 2 },
    { name: 'halo-left',      x: geom.view.w / 2 - 18, y: geom.view.h / 2 },
    { name: 'halo-right',     x: geom.view.w / 2 + 18, y: geom.view.h / 2 },
    { name: 'mic-area',       x: 22, y: geom.view.h / 2 },
    { name: 'expand-area',    x: geom.view.w - 22, y: geom.view.h / 2 },
  ];
  console.log('\n[probe] document.elementFromPoint at each probe:');
  for (const p of probes) {
    const hit = await evalExpr(cdp, `(() => {
      const e = document.elementFromPoint(${p.x}, ${p.y});
      if (!e) return null;
      const chain = []; let n = e;
      while (n && chain.length < 6) { chain.push((n.className || n.tagName)?.toString().slice(0, 32)); n = n.parentElement; }
      return { tag: e.tagName, cls: (e.className || '').toString().slice(0, 80), chain };
    })()`);
    console.log('  ' + p.name.padEnd(16) + ' (' + p.x + ',' + p.y + ') →',
      hit ? (hit.tag + ' .' + hit.cls + '  ↑ ' + hit.chain.join(' › ')) : 'NULL (click-through)');
  }

  // 3. After dispatching CDP mouseMove, what hover ends up on?
  async function mouseMove(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  }
  console.log('\n[probe] after CDP mouseMove to each probe, hover state:');
  for (const p of probes) {
    // First park mouse far outside
    await mouseMove(-10, -10); await sleep(120);
    await mouseMove(p.x, p.y); await sleep(180);
    const snap = await evalExpr(cdp, `(() => {
      const pill = document.querySelector('.pill');
      const r = pill.getBoundingClientRect();
      const hovCap = !!document.querySelector('.pill-idle-capsule:hover');
      const hovFull= !!document.querySelector('.pill-full:hover');
      const hovFace= !!document.querySelector('.pill-idle-face:hover');
      const fullOp = getComputedStyle(document.querySelector('.pill-full')).opacity;
      const capOp  = getComputedStyle(document.querySelector('.pill-idle-capsule')).opacity;
      return { width: r.width.toFixed(1), hovCap, hovFull, hovFace, fullOp, capOp };
    })()`);
    console.log('  ' + p.name.padEnd(16) + ' w=' + snap.width + ' hovCap=' + snap.hovCap +
      ' hovFull=' + snap.hovFull + ' hovFace=' + snap.hovFace + ' fullOp=' + snap.fullOp + ' capOp=' + snap.capOp);
  }

  console.log('\n[probe] done. Leaving VoiceInk running. Kill it with: taskkill /F /IM VoiceInk.exe');
  process.exit(0);
})().catch((e) => { console.error('[probe] fatal:', e); process.exit(3); });
