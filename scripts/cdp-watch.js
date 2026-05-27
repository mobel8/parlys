// Live CDP probe: subscribe to console + log all renderer console messages,
// then run a sequence of test commands (injectText, getSettings, etc.) and
// dump the results. Use to diagnose runtime behaviour without rebuilding.
//
// Usage:  node scripts/cdp-watch.js [command]
//   command = "watch"  (default) — subscribe + run quick diagnostic
//           = "inject TEXT"      — call window.voiceink.injectText(TEXT)
//           = "settings"         — dump getSettings()
//           = "logs"             — dump last main-process logs from runtime.log
//
// Requires the renderer to be running with --remote-debugging-port=9222.

const WebSocket = require('ws');
const http = require('http');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function withRenderer(fn) {
  const targets = await getTargets();
  const t = targets.find((x) => x.type === 'page' && (x.title === 'VoiceInk' || x.url.includes('index.html')));
  if (!t) throw new Error('No VoiceInk page target. Is the renderer up?');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params) {
    return new Promise((res) => {
      const reqId = ++id;
      pending.set(reqId, res);
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }
  ws.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method) {
      // Event push — surface it.
      handleEvent(data);
    }
  });
  function handleEvent(data) {
    if (data.method === 'Runtime.consoleAPICalled') {
      const { type, args, stackTrace } = data.params;
      const text = args.map((a) => a.value !== undefined ? String(a.value) : (a.preview ? JSON.stringify(a.preview) : a.description)).join(' ');
      const where = stackTrace && stackTrace.callFrames && stackTrace.callFrames[0]
        ? ` (${stackTrace.callFrames[0].url.split('/').pop()}:${stackTrace.callFrames[0].lineNumber})`
        : '';
      console.log(`[renderer:${type}]${where} ${text}`);
    } else if (data.method === 'Runtime.exceptionThrown') {
      const e = data.params.exceptionDetails;
      console.log(`[renderer:EXC] ${e.text}: ${e.exception ? e.exception.description : ''}`);
    } else if (data.method === 'Network.responseReceived') {
      const u = data.params.response.url;
      if (u.includes('groq.com') || u.includes('cartesia.ai') || u.includes('elevenlabs')) {
        console.log(`[net] ${data.params.response.status} ${u.split('/').slice(-2).join('/')}`);
      }
    }
  }
  await new Promise((r) => ws.on('open', r));
  await send('Runtime.enable', {});
  await send('Network.enable', {});
  try { return await fn(send); } finally { ws.close(); }
}

async function evalExpr(send, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    return { ok: false, error: r.result.exceptionDetails };
  }
  return { ok: true, value: r.result && r.result.result ? r.result.result.value : null };
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  const command = cmd || 'watch';
  if (command === 'watch') {
    await withRenderer(async (send) => {
      console.log('Watching renderer console... (5 sec)');
      // Also dump current state.
      const checks = {
        autoInject: 'window.voiceink ? true : false',
        recState: '(document.body.dataset.recState||"?")',
        lastError: '(document.body.dataset.lastError||"?")',
      };
      for (const [k, expr] of Object.entries(checks)) {
        const r = await evalExpr(send, expr);
        console.log(`  ${k} = ${JSON.stringify(r.value)}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    });
  } else if (command === 'inject') {
    const text = args.join(' ') || 'test-injection-from-claude';
    await withRenderer(async (send) => {
      const expr = `window.voiceink.injectText(${JSON.stringify(text)}).then(()=>"ok").catch(e=>"err:"+e.message)`;
      const r = await evalExpr(send, expr);
      console.log('inject result:', JSON.stringify(r));
    });
  } else if (command === 'settings') {
    await withRenderer(async (send) => {
      const expr = `window.voiceink.getSettings().then(s=>({autoInject:s.autoInject,autoCopy:s.autoCopy,language:s.language,mode:s.mode,sttPrompt:s.sttPrompt.slice(0,50)}))`;
      const r = await evalExpr(send, expr);
      console.log('settings:', JSON.stringify(r.value, null, 2));
    });
  } else if (command === 'transcribe-test') {
    // Send a deliberately silent/dead audio to see what Whisper returns now.
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(__dirname, '..', args[0] || '_cartesia_short_FR_neutral_voice.mp3');
    const buf = fs.readFileSync(filePath);
    const b64 = buf.toString('base64');
    await withRenderer(async (send) => {
      const expr = `
        window.voiceink.transcribe({
          audioBase64: ${JSON.stringify(b64)},
          mimeType: 'audio/mpeg',
          language: 'fr',
          mode: 'raw'
        }).then(r => ({ok:r.ok, raw:r.rawText, final:r.finalText, lang:r.detectedLanguage, dur:r.durationMs, err:r.error}))
      `;
      const r = await evalExpr(send, expr);
      console.log('transcribe result:', JSON.stringify(r.value, null, 2));
    });
  } else {
    console.error('Unknown command:', command);
    process.exit(2);
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
