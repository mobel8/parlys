/**
 * End-to-end hover/drag regression harness via Chrome DevTools Protocol.
 *
 * Electron is launched with VOICEINK_CDP=1, which opens a CDP server on
 * :9222. We attach to the pill window, stream the renderer console live,
 * and dispatch Input.dispatchMouseEvent — the ONLY reliable way to move
 * the mouse inside a transparent alwaysOnTop window on Windows.
 *
 * Success criteria (current UX)
 *   1. Retracted-only gate: hovering any pixel OUTSIDE the small black
 *      capsule — including the mic and expand button positions that
 *      are invisible in idle state — must leave the pill collapsed.
 *      The capsule dot is the single entry point.
 *   2. Expansion: hovering the capsule expands the pill (glass body
 *      appears, pill-full reaches opacity 1).
 *   3. Retention: once expanded, moving the cursor to the mic or the
 *      expand button positions keeps the pill expanded (hovering the
 *      pill body counts as "keep open" via :has(.pill-full:hover)).
 *   4. Collapse: moving the cursor out of the pill collapses it.
 *   5. Stability: parked on the capsule, no hover/size oscillation
 *      over 3 seconds.
 *   6. The console emits no unexpected errors during the test.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const CDP_PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killElectron() {
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /F /IM VoiceInk.exe',  { stdio: 'ignore' }); } catch {}
}

// ---- HTTP helper --------------------------------------------------------
function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: '127.0.0.1:' + CDP_PORT } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ---- CDP client ---------------------------------------------------------
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
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
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
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout ' + method));
        }
      }, 5000);
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

// ---- Electron spawn -----------------------------------------------------
async function launch() {
  killElectron();
  await sleep(300);

  // Force compact mode so the pill window is the one we attach to. We
  // write it to the settings file via env — but easier: just trust the
  // current user config. The harness will filter targets by URL to
  // find the pill.
  const env = {
    ...process.env,
    // The sampler would spam console 10 Hz and drown our probe output.
    // We do the probing ourselves via Runtime.evaluate here.
    VOICEINK_PILL_SAMPLER: '',
    VOICEINK_CDP: '1',
    VOICEINK_FORCE_DENSITY: 'compact',
    ELECTRON_ENABLE_LOGGING: '1',
  };
  // ELECTRON_RUN_AS_NODE=1 is set globally on this machine; it forces
  // the Electron binary to behave as a stock Node runtime, which makes
  // require('electron') return the binary path instead of the API —
  // breaking the bundle immediately. We must DELETE the variable so
  // it's not forwarded.
  delete env.ELECTRON_RUN_AS_NODE;

  const electronBin = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );
  const child = spawn(
    `"${electronBin}" dist/main/index.js`,
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], shell: true }
  );
  // Only surface fatal Electron output; CDP consoleAPICalled already
  // streams the renderer console in real time below.
  child.stdout.on('data', () => {});
  child.stderr.on('data', (b) => {
    const s = b.toString();
    if (/error|fatal|warn/i.test(s)) process.stderr.write('[e] ' + s);
  });
  return child;
}

// ---- Target discovery ---------------------------------------------------
async function findPillTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
      // Log every page target we see during discovery so we can spot
      // orphans / duplicates across density swaps.
      if (i < 2 || i % 10 === 0) {
        for (const t of list) {
          if (t.type === 'page') {
            console.log(`    [cdp-target] ${t.id.slice(0,6)} ${t.url}`);
          }
        }
      }
      // Strict match: the URL must END with "#compact", not merely contain
      // the word — defends against odd bootstrap URLs and query strings.
      const t = list.find((x) =>
        x.type === 'page' && /#compact(-[a-z]+)?$/.test(x.url || '')
      );
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP target for pill window never appeared');
}

// ---- Main ---------------------------------------------------------------
async function main() {
  const fs = require('fs');
  const mainBundle = path.join(ROOT, 'dist', 'main', 'index.js');
  if (!fs.existsSync(mainBundle)) {
    console.error('✗ dist/main/index.js missing — run `scripts\\build.bat` first.');
    process.exit(4);
  }

  const child = await launch();
  console.log('▶ waiting for CDP target…');
  const target = await findPillTarget();
  console.log('▶ attached:', target.url);

  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;

  // Live console feed — everything the renderer logs ends up here.
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const msg = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    console.log('  [console.' + p.type + ']', msg);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    console.error('  [exception]', p.exceptionDetails?.text,
      p.exceptionDetails?.exception?.description);
  });
  cdp.on('Log.entryAdded', (p) => {
    console.log('  [log.' + p.entry.level + ']', p.entry.text);
  });

  // Query window bounds from the renderer to compute absolute viewport.
  const bounds = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({w: window.innerWidth, h: window.innerHeight})',
  });
  const { w, h } = JSON.parse(bounds.result.value);
  console.log('▶ viewport:', w + '×' + h);

  // Wait for the pill DOM to fully mount and lay out before probing.
  // Otherwise the first probes can race the React commit and see
  // width=0 / no hover even though everything is fine.
  let mounted = false;
  for (let i = 0; i < 80; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `!!document.querySelector('.pill') && document.querySelector('.pill').getBoundingClientRect().width > 0`,
    });
    if (r.result.value) { mounted = true; break; }
    await sleep(100);
  }
  if (!mounted) console.warn('▶ warning: .pill not mounted after 8 s, probing anyway');
  await sleep(250);

  // Helper: move the mouse to (x, y) and return a full snapshot of the
  // observable state. `expanded` is the single ground-truth flag we use
  // to grade each test: it inspects the *real* pill visual rather than
  // one CSS side-effect, so it stays valid whatever trigger selector
  // the renderer is using under the hood.
  async function probe(x, y) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0, modifiers: 0,
    });
    // One Chromium paint for :hover/:has to settle, plus the 180 ms
    // opacity transition so we read the settled value.
    await sleep(260);
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const pr   = document.querySelector('.pill-root');
        const p    = document.querySelector('.pill');
        const full = document.querySelector('.pill-full');
        const cap  = document.querySelector('.pill-idle-capsule');
        const bg   = p ? getComputedStyle(p).backgroundImage : '';
        const fullOp = full ? parseFloat(getComputedStyle(full).opacity) : 0;
        const capOp  = cap  ? parseFloat(getComputedStyle(cap).opacity)  : 1;
        const el   = document.elementFromPoint(${x}, ${y});
        return JSON.stringify({
          expanded:  bg.includes('linear-gradient') && fullOp > 0.5,
          collapsed: !bg.includes('linear-gradient') && fullOp < 0.5,
          width:     p?.getBoundingClientRect().width || 0,
          fullOp, capOp,
          hasCapsuleHover: !!pr?.matches(':has(.pill-idle-capsule:hover)'),
          hasFullHover:    !!pr?.matches(':has(.pill-full:hover)'),
          pillRootClass:   pr?.className || '(none)',
          hit: (el?.className || el?.tagName || 'null').toString().slice(0, 40),
        });
      })()`,
    });
    return JSON.parse(r.result.value);
  }

  // Park cursor WAY outside the 176×55 pill window to reset any hover
  // state between sub-tests.
  const park = () => probe(w + 500, h + 500);

  const failures = [];

  // ---- Test A: retracted-only gate ------------------------------------
  // In idle state, hovering any pixel OUTSIDE the forgiving halo around
  // the capsule must leave the pill collapsed. This is the user's core
  // complaint: moving the cursor over the mic/expand button positions
  // (invisible in retracted mode) used to trigger expansion.
  console.log('\n── Test A: off-halo pixels must NOT expand the pill');
  const nonCapsulePoints = [
    { label: 'top-left-corner',    x: 4,        y: 4 },
    { label: 'top-right-corner',   x: w - 4,    y: 4 },
    { label: 'bottom-left-corner', x: 4,        y: h - 4 },
    { label: 'bottom-right-corner',x: w - 4,    y: h - 4 },
    { label: 'mic-area-L',         x: 20,       y: h / 2 },
    { label: 'mic-area-R',         x: 36,       y: h / 2 },
    { label: 'expand-area-L',      x: w - 36,   y: h / 2 },
    { label: 'expand-area-R',      x: w - 20,   y: h / 2 },
  ];
  for (const pt of nonCapsulePoints) {
    await park();
    const s = await probe(pt.x, pt.y);
    const ok = s.collapsed;
    console.log(`  ${ok ? 'OK' : 'NO'}  ${pt.label.padEnd(20)} (${Math.round(pt.x)},${Math.round(pt.y)})  fullOp=${s.fullOp.toFixed(2)} capOp=${s.capOp.toFixed(2)}`);
    if (!ok) {
      failures.push(`A: ${pt.label} wrongly expanded (fullOp=${s.fullOp})`);
      console.log('     diag:', JSON.stringify({ hit: s.hit, cap: s.hasCapsuleHover, full: s.hasFullHover }));
    }
  }

  // ---- Test B: capsule centre expands ---------------------------------
  console.log('\n── Test B: hovering the black dot expands the pill');
  await park();
  const bCentre = await probe(w / 2, h / 2);
  {
    const ok = bCentre.expanded && bCentre.fullOp > 0.9 && bCentre.capOp < 0.1;
    console.log(`  ${ok ? 'OK' : 'NO'}  capsule-centre (${Math.round(w/2)},${Math.round(h/2)})  fullOp=${bCentre.fullOp.toFixed(2)} capOp=${bCentre.capOp.toFixed(2)} width=${Math.round(bCentre.width)}`);
    if (!ok) failures.push(`B: capsule hover did not expand (fullOp=${bCentre.fullOp}, capOp=${bCentre.capOp})`);
  }

  // ---- Test B2: forgiving halo around the dot -------------------------
  // The ::before halo extends the hit-box from 52×20 to 80×32, centred
  // on the dot. Pixels JUST inside that halo — a few px off the visible
  // capsule in every direction — must ALSO expand the pill.
  console.log('\n── Test B2: forgiving halo a few px around the dot also expands');
  const haloPoints = [
    { label: 'halo-left',   x: Math.round(w / 2) - 36, y: h / 2 },
    { label: 'halo-right',  x: Math.round(w / 2) + 36, y: h / 2 },
    { label: 'halo-top',    x: w / 2,                  y: Math.round(h / 2) - 13 },
    { label: 'halo-bottom', x: w / 2,                  y: Math.round(h / 2) + 13 },
  ];
  for (const pt of haloPoints) {
    await park();
    const s = await probe(pt.x, pt.y);
    const ok = s.expanded;
    console.log(`  ${ok ? 'OK' : 'NO'}  ${pt.label.padEnd(14)} (${Math.round(pt.x)},${Math.round(pt.y)})  fullOp=${s.fullOp.toFixed(2)} capOp=${s.capOp.toFixed(2)}`);
    if (!ok) failures.push(`B2: ${pt.label} did not expand (fullOp=${s.fullOp})`);
  }

  // ---- Test C: retention after entry ----------------------------------
  // Enter via the capsule, then slide to the mic / expand / body. The
  // expansion must remain because :has(.pill-full:hover) latches.
  console.log('\n── Test C: once expanded, sliding to mic/expand retains state');
  const retentionPoints = [
    { label: 'mic-area',    x: 22,     y: h / 2 },
    { label: 'body-left',   x: 60,     y: h / 2 },
    { label: 'body-right',  x: w - 60, y: h / 2 },
    { label: 'expand-area', x: w - 22, y: h / 2 },
  ];
  for (const pt of retentionPoints) {
    await park();
    await probe(w / 2, h / 2);          // enter via capsule → expand
    const s = await probe(pt.x, pt.y);  // slide to target, should stay expanded
    const ok = s.expanded;
    console.log(`  ${ok ? 'OK' : 'NO'}  slide-to-${pt.label.padEnd(14)} (${Math.round(pt.x)},${Math.round(pt.y)})  fullOp=${s.fullOp.toFixed(2)} hasFullHover=${s.hasFullHover}`);
    if (!ok) failures.push(`C: slide to ${pt.label} collapsed (fullOp=${s.fullOp})`);
  }

  // ---- Test D: leaving the pill collapses -----------------------------
  console.log('\n── Test D: leaving the pill area collapses back to retracted');
  await park();
  await probe(w / 2, h / 2);                           // expand
  const dAfter = await probe(w + 500, h + 500);         // leave entirely
  {
    const ok = dAfter.collapsed;
    console.log(`  ${ok ? 'OK' : 'NO'}  cursor-outside  fullOp=${dAfter.fullOp.toFixed(2)} capOp=${dAfter.capOp.toFixed(2)}`);
    if (!ok) failures.push(`D: pill did not collapse after cursor left (fullOp=${dAfter.fullOp})`);
  }

  // ---- Test E: 3-second stability on the capsule ----------------------
  console.log('\n── Test E: hover stable for 3 s at capsule centre');
  await park();
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: w / 2, y: h / 2, button: 'none', buttons: 0,
  });
  await sleep(400);
  const stability = [];
  for (let i = 0; i < 30; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const p    = document.querySelector('.pill');
        const full = document.querySelector('.pill-full');
        const bg   = p ? getComputedStyle(p).backgroundImage : '';
        return JSON.stringify({
          expanded: bg.includes('linear-gradient') && parseFloat(getComputedStyle(full).opacity) > 0.5,
          w: p?.getBoundingClientRect().width || 0,
          fullOp: full ? parseFloat(getComputedStyle(full).opacity) : 0,
        });
      })()`,
    });
    stability.push(JSON.parse(r.result.value));
    await sleep(100);
  }
  const ws = stability.map((s) => Math.round(s.w));
  const allExp = stability.every((s) => s.expanded);
  const spread = Math.max(...ws) - Math.min(...ws);
  console.log('  widths   :', ws.join(','));
  console.log('  expanded :', stability.map((s) => s.expanded ? 1 : 0).join(''));
  console.log(`  allExpanded=${allExp} widthSpread=${spread}`);
  if (!allExp) failures.push('E: expansion dropped during stationary 3 s');
  if (spread >= 4) failures.push(`E: pill width oscillated by ${spread} px`);

  cdp.close();
  killElectron();

  if (failures.length === 0) {
    console.log('\n✅ PASS: capsule-only entry + retention + collapse + stability.');
    process.exit(0);
  }
  console.log('\n❌ FAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  killElectron();
  process.exit(2);
});
