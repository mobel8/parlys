#!/usr/bin/env node
/**
 * Attach to the INSTALLED VoiceInk.exe with CDP and stream every console
 * event (log, warning, error, trace, assert, exception) for `duration`
 * seconds. Also pipes VoiceInk's own stdout/stderr so we see logs from
 * the main process.
 *
 * Goal: catch runtime bugs the static audit missed — unhandled
 * promise rejections, CSS `:has()` support issues, failed fetches,
 * etc. — without having to physically look at the app.
 *
 * Usage:
 *   node scripts/live-console.js            # 30 s, forced compact
 *   node scripts/live-console.js 60         # 60 s
 *   node scripts/live-console.js 30 comfortable
 */
'use strict';
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const INSTALL = path.join(process.env.LOCALAPPDATA, 'Programs', 'VoiceInk', 'VoiceInk.exe');
const CDP_PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const duration = Math.max(5, parseInt(process.argv[2] || '30', 10)) * 1000;
const density  = process.argv[3] || 'compact';

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
  constructor(ws, tag = '') {
    this.ws = new WebSocket(ws);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.tag = tag;
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
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

// Counters so we can report a summary at the end.
const stats = { log: 0, warning: 0, error: 0, exception: 0, networkFail: 0 };

function tagLine(tag, level, text) {
  stats[level] = (stats[level] || 0) + 1;
  const trimmed = String(text).replace(/\n+/g, ' | ').slice(0, 400);
  console.log(`[${tag}][${level}] ${trimmed}`);
}

(async () => {
  console.log('====================================');
  console.log(' LIVE CONSOLE —', duration / 1000, 's, density =', density);
  console.log('====================================');
  killAll(); await sleep(500);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VOICEINK_CDP = '1';
  env.VOICEINK_FORCE_DENSITY = density;

  const child = spawn(INSTALL, [], {
    shell: false, detached: false, windowsHide: false, env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const l of lines) console.log('[main:stdout] ' + l);
  });
  child.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const l of lines) {
      console.log('[main:stderr] ' + l);
      if (/error|exception|fail/i.test(l)) stats.error++;
    }
  });

  // Wait for CDP.
  let targets = [];
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    try {
      targets = await httpJson(`http://127.0.0.1:${CDP_PORT}/json`);
      targets = targets.filter((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (targets.length) break;
    } catch {}
  }
  if (!targets.length) { console.error('CDP never came up'); killAll(); process.exit(1); }

  // Attach to EVERY page target so we don't miss the comfortable window
  // if a density swap happens during the session.
  const cdpList = [];
  for (const t of targets) {
    const tag = /compact/.test(t.url) ? 'compact' : /comfortable/.test(t.url) ? 'comfy' : 'page';
    const cdp = new CDP(t.webSocketDebuggerUrl, tag);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    cdp.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }) => {
      const txt = args.map((a) => a.value ?? a.description ?? '').join(' ');
      tagLine(tag, type, txt);
      if (type === 'error' && stackTrace) {
        const top = stackTrace.callFrames?.[0];
        if (top) console.log(`[${tag}][error]   at ${top.functionName || '<anon>'} (${top.url}:${top.lineNumber}:${top.columnNumber})`);
      }
    });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      stats.exception++;
      const e = exceptionDetails?.exception;
      const desc = e?.description || e?.value || JSON.stringify(exceptionDetails);
      console.log(`[${tag}][exception] ${String(desc).replace(/\n+/g, ' | ').slice(0, 600)}`);
    });
    cdp.on('Network.loadingFailed', ({ errorText, requestId, type: resType }) => {
      if (/net::ERR_ABORTED/.test(errorText)) return; // noisy benign
      stats.networkFail++;
      console.log(`[${tag}][net-fail] ${resType || '?'} ${errorText} id=${requestId}`);
    });
    cdpList.push(cdp);
  }

  console.log(`[attach] ${cdpList.length} target(s): ${targets.map((t) => t.url.split('#').pop() || '?').join(', ')}`);

  // Keep listening for the requested duration.
  await sleep(duration);

  console.log('\n====================================');
  console.log(' SESSION STATS');
  console.log('====================================');
  for (const k of Object.keys(stats)) console.log(`  ${k.padEnd(12)} ${stats[k]}`);
  console.log('====================================');

  killAll();
  await sleep(400);
  process.exit(stats.error + stats.exception + stats.networkFail > 0 ? 2 : 0);
})().catch((e) => { console.error('live-console error:', e); killAll(); process.exit(1); });
