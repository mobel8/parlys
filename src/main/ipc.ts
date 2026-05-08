import { ipcMain, clipboard, app, dialog, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { IPC, TranscribeResponse, InterpretResponse, InterpretChunkEvent, Settings, VoiceInfo, TTSProvider } from '../shared/types';
import { getSettings, setSettings } from './services/config';
import { transcribeWithGroq } from './engines/whisper';
import { postProcess, translateText, streamTranslate, prewarmGroq } from './engines/llm';
import { streamTTS } from './engines/tts';
import { listVoices } from './engines/tts/catalog';
import { prewarmCartesia } from './engines/tts/cartesia';
import {
  listHistory,
  addHistory,
  deleteHistory,
  clearHistory,
  togglePinHistory,
  getUsageStats,
  exportHistory,
} from './services/history';
import { injectText, copyToClipboard } from './services/injection';
import { applyReplacements, wordCount } from './services/replacements';
import { reRegisterShortcuts } from './shortcuts';
import { checkForUpdates, installAndRestart, getUpdaterState } from './updater';
import {
  sanitizeSettingsPatch,
  validateHistoryId,
  validateExportFormat,
  validateTranscribeRequest,
  validateInterpretRequest,
  validateText,
} from './services/validate';

/**
 * Cache of the last language Whisper detected for each kind of audio
 * pipeline, used as a hint on the next call so the model skips its
 * language-detection step (~14 ms saved per call, measured).
 *
 * We bucket by pipeline because the user might dictate in French for
 * the interpreter but listen to English audio in the listener — we
 * don't want those to cross-pollute.
 *
 * Scope: in-memory only. Cleared on app restart, which is fine —
 * re-detecting once per session is imperceptible.
 */
const LANG_HINTS: { interpret?: string; listener?: string } = {};

export function registerIpc(): void {
  ipcMain.handle(IPC.GET_SETTINGS, (): Settings => getSettings());
  ipcMain.handle(IPC.SET_SETTINGS, (_e, patch: unknown) => {
    const sanitized = sanitizeSettingsPatch(patch);
    const before = getSettings();
    const next = setSettings(sanitized);
    // Re-register global accelerators if any shortcut-related field
    // changed. Without this the user has to restart the app for a new
    // hotkey to take effect — surprising and easy to miss.
    const shortcutsChanged =
      before.shortcutToggle !== next.shortcutToggle ||
      before.shortcutPTT !== next.shortcutPTT ||
      before.shortcutInterpreter !== next.shortcutInterpreter ||
      before.pttEnabled !== next.pttEnabled;
    if (shortcutsChanged) {
      try { reRegisterShortcuts(); } catch (e) { console.warn('[ipc:set] reRegister failed', e); }
    }
    // Broadcast to every renderer (main + any secondary, e.g. future
    // panels) so their Zustand store sees the new value without having
    // to poll getSettings. Does NOT echo back to the sender — the
    // invoke()'s return value already carries the new state.
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      if (win.webContents === _e.sender) continue;
      try { win.webContents.send(IPC.ON_SETTINGS_CHANGED, next); } catch { /* ignore */ }
    }
    return next;
  });

  ipcMain.handle(IPC.GET_HISTORY, () => listHistory());
  ipcMain.handle(IPC.ADD_HISTORY, (_e, entry) => addHistory(entry));
  ipcMain.handle(IPC.DELETE_HISTORY, (_e, id: unknown) => {
    const safe = validateHistoryId(id);
    if (!safe) return;
    return deleteHistory(safe);
  });
  ipcMain.handle(IPC.CLEAR_HISTORY, () => clearHistory());
  ipcMain.handle(IPC.TOGGLE_PIN_HISTORY, (_e, id: unknown) => {
    const safe = validateHistoryId(id);
    if (!safe) return false;
    return togglePinHistory(safe);
  });
  ipcMain.handle(IPC.GET_USAGE_STATS, () => getUsageStats());

  ipcMain.handle(IPC.EXPORT_HISTORY, async (event, rawFormat: unknown) => {
    const format = validateExportFormat(rawFormat);
    if (!format) return { ok: false, error: 'invalid format' };
    const { filename, content } = exportHistory(format);
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
    const res = await dialog.showSaveDialog(win!, {
      title: 'Exporter l\'historique',
      defaultPath: filename,
      filters: [
        format === 'json'     ? { name: 'JSON',     extensions: ['json'] } :
        format === 'markdown' ? { name: 'Markdown', extensions: ['md'] } :
        format === 'csv'      ? { name: 'CSV',      extensions: ['csv'] } :
                                { name: 'Texte',    extensions: ['txt'] },
      ],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      await writeFile(res.filePath, content, 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle(IPC.SET_AUTO_START, (_e, enabled: unknown) => {
    const flag = !!enabled; // explicit boolean coerce
    try {
      app.setLoginItemSettings({
        openAtLogin: flag,
        // --hidden is read by main/index.ts to decide whether to hide the window on startup.
        args: flag ? ['--hidden'] : [],
      });
      setSettings({ autoStart: flag });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle(IPC.COPY_TEXT, (_e, text: unknown) => {
    const safe = validateText(text);
    if (safe === null) return;
    copyToClipboard(safe);
  });
  ipcMain.handle(IPC.INJECT_TEXT, (_e, text: unknown) => {
    const safe = validateText(text);
    if (safe === null) return;
    return injectText(safe);
  });

  ipcMain.handle(IPC.TRANSCRIBE, async (_e, rawReq: unknown): Promise<TranscribeResponse> => {
    const req = validateTranscribeRequest(rawReq);
    if (!req) {
      return { ok: false, rawText: '', finalText: '', durationMs: 0, error: 'invalid request' };
    }
    const t0 = Date.now();
    try {
      const settings = getSettings();
      const buf = Buffer.from(req.audioBase64, 'base64');
      console.log(`[transcribe] received audio: ${buf.length} bytes (${req.mimeType})`);
      if (buf.length < 500) {
        throw new Error('Audio trop court / silencieux. Parlez un peu plus longtemps.');
      }

      const t1 = Date.now();
      const r = await transcribeWithGroq(buf, req.mimeType, settings);
      const t2 = Date.now();
      console.log(`[transcribe] groq whisper: ${t2 - t1}ms → "${r.text.slice(0, 80)}" (lang=${r.language || '?'})`);

      // Custom dictionary (replacements) — applied to the RAW Whisper output
      // before anything else so translation / LLM see the corrected text.
      let rawText = r.text;
      if (settings.replacementsEnabled !== false && settings.replacements?.length) {
        const rs = Date.now();
        rawText = applyReplacements(rawText, settings.replacements);
        if (rawText !== r.text) {
          console.log(`[transcribe] applied ${settings.replacements.length} replacement rule(s) in ${Date.now() - rs}ms`);
        }
      }

      // Automatic translation if target language requested (explicit in request
      // takes precedence over stored setting).
      const translateTo = (req.translateTo !== undefined ? req.translateTo : settings.translateTo) || '';
      let translated: string | null = null;
      if (translateTo && rawText.trim()) {
        const ts = Date.now();
        translated = await translateText(rawText, translateTo, settings, r.language);
        console.log(`[transcribe] translation → ${translateTo}: ${Date.now() - ts}ms`);
      }

      // LLM post-processing operates on whichever text we'll present
      // (translated if any, else raw) so the reformulation is in the
      // final target language. postProcess resolves the {{LANG}}
      // placeholder internally from (1) the explicit translation
      // target, (2) Whisper's detected language, or (3) the user's
      // language setting — in that order.
      let final = translated ?? rawText;
      if (req.mode !== 'raw') {
        const ps = Date.now();
        const langHint = translateTo || r.language;
        final = await postProcess(final, req.mode, settings, langHint);
        console.log(`[transcribe] llm post-process mode=${req.mode}: ${Date.now() - ps}ms`);
      }

      const durationMs = Date.now() - t0;

      addHistory({
        id: randomUUID(),
        createdAt: Date.now(),
        rawText,
        finalText: final,
        mode: req.mode,
        language: r.language || req.language || 'auto',
        translatedTo: translateTo || undefined,
        durationMs,
        audioMs: 0,
        tags: [],
        wordCount: wordCount(final),
      });

      if (settings.autoCopy || settings.autoInject) {
        try { clipboard.writeText(final); } catch {}
      }

      return {
        ok: true,
        rawText,
        finalText: final,
        detectedLanguage: r.language,
        translatedTo: translateTo || undefined,
        durationMs,
      };
    } catch (err: any) {
      console.error('[transcribe] error:', err?.message || err);
      return {
        ok: false,
        rawText: '',
        finalText: '',
        durationMs: Date.now() - t0,
        error: err?.message || String(err),
      };
    }
  });

  // -------------------------------------------------------------------
  // INTERPRETER — voice-to-voice translation pipeline.
  //
  //   Audio in (Whisper) → translated text (Groq llama) → streamed
  //   MP3 chunks pushed to the renderer via IPC.ON_INTERPRET_CHUNK.
  //
  // The handler returns the final metadata (rawText, translatedText,
  // ttfbMs) synchronously once the last chunk has been emitted, so the
  // renderer can show latency stats next to the classic transcribe
  // ones. Chunks are streamed as soon as they arrive from the TTS
  // provider — playback begins ~300-800 ms after end-of-audio on a
  // cold path.
  // -------------------------------------------------------------------
  ipcMain.handle(IPC.INTERPRET, async (event, rawReq: unknown): Promise<InterpretResponse> => {
    const req = validateInterpretRequest(rawReq);
    if (!req) {
      return {
        ok: false, requestId: '', rawText: '', translatedText: '',
        durationMs: 0, error: 'invalid request',
      };
    }
    const sender = event.sender;
    const send = (payload: InterpretChunkEvent) => {
      if (!sender.isDestroyed()) {
        sender.send(IPC.ON_INTERPRET_CHUNK, payload);
      }
    };

    const t0 = Date.now();
    let seq = 0;
    let ttfbMs: number | undefined;
    try {
      const settings = getSettings();
      const buf = Buffer.from(req.audioBase64, 'base64');
      console.log(`[interpret] received audio: ${buf.length} bytes (${req.mimeType}) → ${req.targetLang}`);
      if (buf.length < 500) {
        throw new Error('Audio trop court / silencieux. Parlez un peu plus longtemps.');
      }

      // Fire-and-forget TLS warm-up for every origin we're about to
      // hit. Each of these 2 calls opens a TLS session that undici's
      // global agent keeps pooled for ~60 s. When we then POST to the
      // real endpoints, no TCP + TLS handshake → ~40-100 ms saved per
      // host, compounded over Whisper + translate + TTS.
      prewarmGroq(settings.groqApiKey || settings.llmApiKey || '');
      if (settings.ttsProvider === 'cartesia') {
        prewarmCartesia(settings.ttsApiKey?.cartesia || '');
      }

      // 1) Whisper transcription in the SOURCE language.
      //
      // Language-hint waterfall (fastest detection wins):
      //   1. explicit req.sourceLang from the client (user picked a lang)
      //   2. cached lang from the previous interpret in this session
      //      (auto-learning — 99% of users stay in one lang per session)
      //   3. settings.language if not 'auto' (configured globally)
      //   4. fall back to auto-detect (costs ~14 ms extra on Groq)
      const t1 = Date.now();
      const explicitLang = req.sourceLang && req.sourceLang !== 'auto' ? req.sourceLang : '';
      const hintLang = explicitLang
        || LANG_HINTS.interpret
        || (settings.language && settings.language !== 'auto' ? settings.language : '');
      const whisperSettings = hintLang
        ? { ...settings, language: hintLang }
        : settings;
      const r = await transcribeWithGroq(buf, req.mimeType, whisperSettings);
      // Refresh the cache with whatever Whisper actually detected so
      // the NEXT call benefits from the hint. Normalized to lower-case.
      if (r.language && typeof r.language === 'string') {
        LANG_HINTS.interpret = r.language.toLowerCase();
      }
      console.log(`[interpret] whisper: ${Date.now() - t1}ms → "${r.text.slice(0, 80)}" (lang=${r.language || '?'}, hint=${hintLang || 'auto'})`);

      let rawText = r.text;
      if (settings.replacementsEnabled !== false && settings.replacements?.length) {
        rawText = applyReplacements(rawText, settings.replacements);
      }

      if (!rawText.trim()) {
        throw new Error('Aucune parole détectée dans l\'audio.');
      }

      // 2) + 3) Streaming translate *overlapped* with streaming TTS.
      //
      // The naive pipeline runs translate to completion (~150-400 ms),
      // then starts TTS (another ~150-250 ms before the first MP3
      // byte). Here we kick off two smaller TTS calls back-to-back:
      // the first one starts the moment the translator emits a full
      // sentence (end mark `.!?` or end-of-stream), the second covers
      // whatever arrives afterwards. For short utterances (one
      // sentence, the common case) the second branch is a no-op.
      //
      // Net win: the user starts hearing the translation ~100-250 ms
      // earlier, because the TTS handshake (TCP + TLS + server warm-up)
      // overlaps with the final tokens of the translator instead of
      // happening after them.
      const t2 = Date.now();
      const dispatchTTS = async (partial: string): Promise<void> => {
        for await (const { chunk, mime } of streamTTS(settings, partial, { language: req.targetLang })) {
          if (ttfbMs === undefined) {
            ttfbMs = Date.now() - t2;
            console.log(`[interpret] first audio chunk after ${ttfbMs}ms from translate start`);
          }
          send({
            requestId: req.requestId,
            seq: seq++,
            chunkBase64: chunk.toString('base64'),
            mime,
            done: false,
          });
        }
      };

      let translatedFull = '';
      let pending = '';
      // Queue of in-flight TTS tasks so we can await them IN ORDER
      // before emitting the final done-sentinel. We never kick off
      // more than one TTS at a time — sequential playback is the
      // desired UX (otherwise the user hears two voices overlap).
      let ttsQueue: Promise<void> = Promise.resolve();
      let firstSentenceSent = false;

      // Global master switch — when OFF, we skip every TTS call (saves
      // API credits) and the renderer will only show the translated
      // text. The translate stream still runs because the user WANTS
      // the text.
      const speakOn = settings.speakTranslations !== false;

      for await (const delta of streamTranslate(rawText, req.targetLang, settings, r.language)) {
        translatedFull += delta;
        pending += delta;
        if (!speakOn) continue;
        // Scan the pending buffer for a natural sentence boundary.
        // We look for the LAST terminal mark so a single multi-sentence
        // delta gets split into two TTS calls if the model emits it in
        // one shot (rare but possible on 8B).
        const match = pending.match(/^([\s\S]*[.!?…])(\s+|$)/);
        if (match && !firstSentenceSent) {
          const firstChunk = match[1].trim();
          pending = pending.slice(match[0].length);
          if (firstChunk.length >= 2) {
            firstSentenceSent = true;
            const toSpeak = firstChunk;
            ttsQueue = ttsQueue.then(() => dispatchTTS(toSpeak));
          }
        }
      }
      console.log(`[interpret] translate stream done in ${Date.now() - t2}ms → "${translatedFull.slice(0, 80)}"${speakOn ? '' : ' (TTS disabled)'}`);

      if (speakOn) {
        // Whatever is left in `pending` after the stream closes is the
        // tail (if we split) or the full translation (if we never hit a
        // sentence mark — one-word inputs, abbreviations, etc.).
        const tail = pending.trim();
        if (tail.length > 0) {
          ttsQueue = ttsQueue.then(() => dispatchTTS(tail));
        }
      }
      // If the stream produced nothing useful, fall back to the one-shot
      // translate so the user still gets the text (and audio if enabled).
      // Should be rare.
      if (!translatedFull.trim()) {
        console.warn('[interpret] translate stream produced empty output, falling back to one-shot');
        const oneShot = await translateText(rawText, req.targetLang, settings, r.language);
        if (oneShot.trim()) {
          translatedFull = oneShot;
          if (speakOn) {
            ttsQueue = ttsQueue.then(() => dispatchTTS(oneShot));
          }
        }
      }

      // Drain every TTS call we kicked off before signalling completion.
      await ttsQueue;

      const translated = translatedFull.trim();

      // Flush sentinel so the renderer can close its MediaSource buffer.
      // Always sent, even when TTS is off, so the renderer's queue
      // state-machine resolves cleanly instead of waiting forever.
      send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true });

      const durationMs = Date.now() - t0;
      console.log(`[interpret] done: total=${durationMs}ms, ttfb=${ttfbMs}ms, chunks=${seq}`);

      addHistory({
        id: randomUUID(),
        createdAt: Date.now(),
        rawText,
        finalText: translated,
        mode: 'raw',
        language: r.language || req.sourceLang || 'auto',
        translatedTo: req.targetLang,
        durationMs,
        audioMs: 0,
        tags: ['interpret'],
        wordCount: wordCount(translated),
      });

      return {
        ok: true,
        requestId: req.requestId,
        rawText,
        translatedText: translated,
        detectedLanguage: r.language,
        durationMs,
        ttfbMs,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[interpret] error:', msg);
      // Tell the renderer to tear down its player.
      send({
        requestId: req.requestId,
        seq: seq++,
        chunkBase64: '',
        mime: 'audio/mpeg',
        done: true,
        error: msg,
      });
      return {
        ok: false,
        requestId: req.requestId,
        rawText: '',
        translatedText: '',
        durationMs: Date.now() - t0,
        error: msg,
      };
    }
  });

  // -------------------------------------------------------------------
  // PREWARM — fire-and-forget TLS session opener. Called by the
  // renderer the moment the user starts recording so all HTTPS pipes
  // (Groq + TTS provider) are hot by the time the audio upload begins.
  // The payload is irrelevant — only the TCP + TLS handshake matters.
  // Saves 40-80 ms on EACH of Whisper, translate and TTS when the
  // socket is still in undici's pool.
  // -------------------------------------------------------------------
  ipcMain.on(IPC.PREWARM, () => {
    const settings = getSettings();
    prewarmGroq(settings.groqApiKey || settings.llmApiKey || '');
    if (settings.ttsProvider === 'cartesia') {
      prewarmCartesia(settings.ttsApiKey?.cartesia || '');
    }
  });

  // -------------------------------------------------------------------
  // LIST_VOICES — fetch the live voice catalog from a TTS provider so
  // the Settings UI can render a filterable picker with every available
  // voice (~100 from Cartesia, 30+ premade ElevenLabs, 11 OpenAI).
  //
  // The renderer caches the list client-side for 1h per provider, so
  // this handler is called rarely (on Settings mount + manual refresh).
  // -------------------------------------------------------------------
  ipcMain.handle(IPC.LIST_VOICES, async (_e, providerRaw: unknown): Promise<VoiceInfo[]> => {
    const provider = (typeof providerRaw === 'string' ? providerRaw : '') as TTSProvider;
    if (!['cartesia', 'elevenlabs', 'openai'].includes(provider)) {
      return [];
    }
    const settings = getSettings();
    const apiKey = settings.ttsApiKey?.[provider] || '';
    try {
      const list = await listVoices(provider, apiKey);
      console.log(`[voices] ${provider}: ${list.length} voices`);
      return list;
    } catch (err: any) {
      console.error(`[voices] ${provider} error:`, err?.message || err);
      return [];
    }
  });

  // -------------------------------------------------------------------
  // SPEAK — simple text-to-speech bypassing Whisper. Streams MP3 chunks
  // on the same IPC.ON_INTERPRET_CHUNK channel so the renderer can
  // reuse the existing InterpretPlayer. Used by the Listener's audio
  // mode (the text is already in the target language so we just need
  // voice synthesis).
  // -------------------------------------------------------------------
  ipcMain.handle(IPC.SPEAK, async (event, rawReq: unknown): Promise<{ ok: boolean; ttfbMs?: number; error?: string; requestId: string }> => {
    const req = rawReq as { requestId: string; text: string; language?: string };
    if (!req || !req.requestId || !req.text?.trim()) {
      return { ok: false, requestId: req?.requestId || '', error: 'invalid request' };
    }
    const sender = event.sender;
    const send = (payload: InterpretChunkEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.ON_INTERPRET_CHUNK, payload);
    };
    let seq = 0;
    let ttfbMs: number | undefined;
    try {
      const settings = getSettings();
      // Master mute — skip TTS entirely, but still fire the done
      // sentinel so the renderer's MediaSource queue resolves instead
      // of stalling (InterpretPlayer would otherwise leak buffers).
      if (settings.speakTranslations === false) {
        send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true });
        return { ok: true, requestId: req.requestId };
      }
      const t0 = Date.now();
      const iter = streamTTS(settings, req.text, { language: req.language });
      for await (const { chunk, mime } of iter) {
        if (ttfbMs === undefined) ttfbMs = Date.now() - t0;
        send({
          requestId: req.requestId,
          seq: seq++,
          chunkBase64: chunk.toString('base64'),
          mime,
          done: false,
        });
      }
      send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true });
      return { ok: true, ttfbMs, requestId: req.requestId };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[speak] error:', msg);
      send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true, error: msg });
      return { ok: false, error: msg, requestId: req.requestId };
    }
  });

  // -------------------------------------------------------------------
  // LISTENER_TRANSCRIBE — one-shot audio segment → transcription +
  // optional translation. Called by the listener hook once per VAD
  // segment. Returns *both* the source transcription and the translated
  // text so the UI can render side-by-side. If listenerMode='audio',
  // the renderer itself kicks off a TTS playback via IPC.INTERPRET —
  // no new pipeline needed here, just the text response.
  // -------------------------------------------------------------------
  ipcMain.handle(IPC.LISTENER_TRANSCRIBE, async (_e, rawReq: unknown): Promise<{
    ok: boolean;
    text: string;
    translated?: string;
    sourceLang?: string;
    error?: string;
  }> => {
    try {
      const req = rawReq as { audioBase64: string; mimeType: string; targetLang: string; sourceLang?: string };
      if (!req || typeof req.audioBase64 !== 'string' || !req.audioBase64) {
        return { ok: false, text: '', error: 'invalid request' };
      }
      const settings = getSettings();
      const buf = Buffer.from(req.audioBase64, 'base64');
      if (buf.length < 500) {
        return { ok: false, text: '', error: 'audio too short' };
      }
      const explicitLangL = req.sourceLang && req.sourceLang !== 'auto' ? req.sourceLang : '';
      const listenerHint = explicitLangL
        || LANG_HINTS.listener
        || (settings.language && settings.language !== 'auto' ? settings.language : '');
      const whisperSettings = listenerHint ? { ...settings, language: listenerHint } : settings;
      const wh = await transcribeWithGroq(buf, req.mimeType, whisperSettings);
      if (wh.language && typeof wh.language === 'string') {
        LANG_HINTS.listener = wh.language.toLowerCase();
      }
      const text = (settings.replacementsEnabled && settings.replacements?.length)
        ? applyReplacements(wh.text, settings.replacements)
        : wh.text;
      if (!text.trim()) {
        return { ok: true, text: '', sourceLang: wh.language };
      }
      let translated: string | undefined;
      const tgt = req.targetLang;
      // Only translate if target differs from detected source.
      if (tgt && tgt !== wh.language && tgt !== listenerHint) {
        try {
          translated = await translateText(text, tgt, settings, wh.language);
        } catch (err: any) {
          console.warn('[listener] translate failed:', err?.message);
          // Graceful degradation — still return the transcription.
        }
      }
      return { ok: true, text, translated, sourceLang: wh.language };
    } catch (err: any) {
      console.error('[listener] error:', err?.message || err);
      return { ok: false, text: '', error: err?.message || String(err) };
    }
  });

  // -------------------------------------------------------------------
  // Auto-updater handlers. All three are fire-and-forget from the
  // renderer's perspective — the actual state machine lives in
  // src/main/updater.ts and pushes transitions via ON_UPDATER_STATE.
  // -------------------------------------------------------------------
  ipcMain.handle(IPC.UPDATER_CHECK, async () => {
    await checkForUpdates();
  });
  ipcMain.handle(IPC.UPDATER_INSTALL, () => {
    // Fires app.quit() → app.relaunch() internally. No return value
    // meaningful; by the time the renderer would read it, we're gone.
    installAndRestart();
  });
  ipcMain.handle(IPC.UPDATER_GET_STATE, () => {
    return getUpdaterState();
  });
}
