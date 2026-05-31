import { ipcMain, clipboard, app, dialog, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import { IPC, TranscribeResponse, InterpretResponse, InterpretChunkEvent, Settings, VoiceInfo, TTSProvider } from '../shared/types';
import { getSettings, setSettings } from './services/config';
import { transcribeWithGroq } from './engines/whisper';
import { postProcess, translateText, streamTranslate, prewarmGroq, prewarmLlm } from './engines/llm';
import { cleanupTranscription } from './services/text-cleanup';
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
import { abortableSignal } from './services/abort';
import { reRegisterShortcuts } from './shortcuts';
import { checkForUpdates, installAndRestart, getUpdaterState } from './updater';
import {
  sanitizeSettingsPatch,
  validateHistoryId,
  validateExportFormat,
  validateTranscribeRequest,
  validateInterpretRequest,
  validateText,
  validateSpeakRequest,
  validateListenerTranscribeRequest,
  validateHistoryEntry,
  sanitizeInjectionText,
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

/**
 * Per-stage deadlines for external (STT / LLM / TTS) calls.
 *
 * Before this, every external fetch ran with NO timeout: a stalled upstream
 * (Groq/Cartesia holding the socket open without sending bytes) hung the IPC
 * handler forever, and the streaming handlers never emitted their done
 * sentinel so the renderer's MediaSource leaked. These are GENEROUS on
 * purpose — a slow-but-valid call (large audio, a cold 70B model, a long
 * translation) must never trip the deadline. They exist only to bound a
 * truly-dead connection. Tune up if real calls ever legitimately exceed them.
 *
 * NOTE (streaming refinement, future): INTERPRET/SPEAK use a SINGLE per-stage
 * deadline covering the whole stream. A nicer model would reset the deadline
 * on every received chunk (so a long-but-healthy stream can't trip it) — left
 * out here to keep the change minimal; the generous value makes it a non-issue
 * in practice for utterance-length audio.
 */
const STT_TIMEOUT_MS = 60_000; // Whisper transcription (incl. up to 3 back-offs).
const LLM_TIMEOUT_MS = 90_000; // post-process / translate (streaming or one-shot).
const TTS_TIMEOUT_MS = 60_000; // full TTS stream for one utterance/sentence.

/**
 * In-flight abort controllers for the STREAMING handlers (#6). When a NEW
 * interpret/speak request arrives we abort the PREVIOUS one with reason
 * 'superseded' so its still-running fetch stops wasting credits and we don't
 * hear two utterances overlap. Each handler clears its slot in `finally` iff
 * it is still the current owner (a newer request may have already replaced it).
 */
let currentInterpretAbort: AbortController | null = null;
let currentSpeakAbort: AbortController | null = null;

/**
 * Distinguish a "superseded" abort (a newer request quietly replaced this
 * one — the renderer should just finish the phrase, NO error) from a timeout
 * or genuine failure (the UI should warn). Keyed off the reason we pass to
 * controller.abort('superseded').
 */
function isSupersededReason(reason: unknown): boolean {
  return reason === 'superseded'
    || (typeof reason === 'object' && reason !== null && (reason as any).message === 'superseded');
}

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
    // Live-resize the pill window when the user moves the scale slider
    // in Settings. We only resize the COMPACT window because the
    // comfortable window doesn't read pillScale. The top-left anchor is
    // preserved (we re-pass the current x,y) so the user's drag position
    // survives the resize.
    if ((next as any).pillScale !== (before as any).pillScale) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        const [w, h] = win.getSize();
        // The pill is the only window with width < 400 — cheap heuristic
        // that avoids needing to track densities per HWND here.
        if (w < 400) {
          try {
            const scale = Math.max(0.5, Math.min(1.5, (next as any).pillScale || 1));
            const newW = Math.round(176 * scale);
            const newH = Math.round(52 * scale);
            // Relax min/max BEFORE resize — they were locked at constructor
            // time to the prior dimensions and would otherwise refuse the
            // new format.
            win.setMinimumSize(newW, newH);
            win.setMaximumSize(newW, newH);
            const [x, y] = win.getPosition();
            win.setBounds({ x, y, width: newW, height: newH }, false);
            // Tell the renderer to re-stamp --pill-scale + data-window so
            // its zoom matches the new native bounds in the SAME frame.
            try { win.webContents.send('voiceink:pillScaleChanged', scale); } catch { /* ignore */ }
          } catch (e) { console.warn('[ipc:set] pill resize failed', e); }
        }
      }
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
  ipcMain.handle(IPC.ADD_HISTORY, (_e, entry: unknown) => {
    const safe = validateHistoryEntry(entry);
    if (!safe) return { ok: false, error: 'invalid history entry' };
    return addHistory(safe as any);
  });
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
    // Strict boolean: reject non-bool inputs entirely rather than
    // accepting any truthy value (was previously `!!enabled` which silently
    // accepted strings, numbers, etc.).
    if (typeof enabled !== 'boolean') return { ok: false, error: 'expected boolean' };
    const flag = enabled;
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
      // Self-prewarm (belt-and-suspenders): warm the Whisper origin AND the
      // configured post-process LLM origin in case the renderer's record-start
      // PREWARM was dropped. Fire-and-forget; the pooled socket is reused by
      // the Whisper POST + post-process below.
      prewarmGroq(settings.groqApiKey || settings.llmApiKey || '');
      if (req.mode !== 'raw') prewarmLlm(settings);
      const buf = Buffer.from(req.audioBase64, 'base64');
      console.log(`[transcribe] received audio: ${buf.length} bytes (${req.mimeType})`);
      // 1.2 KB ≈ a typical 100 ms opus frame + webm header — anything smaller
      // is almost certainly an empty container the user produced by mis-clicking
      // the record button. Was 500 B which was so low it accepted header-only
      // blobs and shipped them to Whisper, which returned hallucinated text.
      if (buf.length < 1200) {
        throw new Error('Audio trop court / silencieux. Parlez un peu plus longtemps.');
      }

      const t1 = Date.now();
      // Per-stage deadline so a stalled Groq socket can't hang this handler
      // forever. dispose() in finally guarantees the timer never leaks.
      const sttAb = abortableSignal(STT_TIMEOUT_MS);
      let r: Awaited<ReturnType<typeof transcribeWithGroq>>;
      try {
        r = await transcribeWithGroq(buf, req.mimeType, settings, sttAb.signal);
      } finally {
        sttAb.dispose();
      }
      const t2 = Date.now();
      console.log(`[transcribe] groq whisper: ${t2 - t1}ms → "${r.text.slice(0, 80)}" (lang=${r.language || '?'})`);

      // Hallucination + filler scrubbing — runs in EVERY mode (incl. raw)
      // because the LLM modes are the only thing that used to strip
      // "euh"/"um" and we don't want raw mode to be the broken one. The
      // hallucination filter also catches "Merci d'avoir regardé"-style
      // YouTube tails Whisper emits on trailing silence.
      const cleaned = cleanupTranscription(r.text, r.language || settings.language);
      if (cleaned !== r.text) {
        console.log(`[transcribe] cleanup: ${r.text.length}→${cleaned.length}ch (fillers/hallucinations)`);
      }

      // Custom dictionary (replacements) — applied to the cleaned Whisper
      // output before anything else so translation / LLM see the corrected
      // text.
      let rawText = cleaned;
      if (settings.replacementsEnabled !== false && settings.replacements?.length) {
        const rs = Date.now();
        rawText = applyReplacements(rawText, settings.replacements);
        if (rawText !== cleaned) {
          console.log(`[transcribe] applied ${settings.replacements.length} replacement rule(s) in ${Date.now() - rs}ms`);
        }
      }

      // Automatic translation if target language requested (explicit in request
      // takes precedence over stored setting).
      const translateTo = (req.translateTo !== undefined ? req.translateTo : settings.translateTo) || '';
      let translated: string | null = null;
      let translateFailed = false;
      if (translateTo && rawText.trim()) {
        const ts = Date.now();
        const trAb = abortableSignal(LLM_TIMEOUT_MS);
        try {
          translated = await translateText(rawText, translateTo, settings, r.language, () => { translateFailed = true; }, trAb.signal);
        } finally {
          trAb.dispose();
        }
        console.log(`[transcribe] translation → ${translateTo}: ${Date.now() - ts}ms${translateFailed ? ' (FAILED → source text)' : ''}`);
      }

      // LLM post-processing operates on whichever text we'll present
      // (translated if any, else raw) so the reformulation is in the
      // final target language. postProcess resolves the {{LANG}}
      // placeholder internally from (1) the explicit translation
      // target, (2) Whisper's detected language, or (3) the user's
      // language setting — in that order.
      let final = translated ?? rawText;
      let postProcessFailed = false;
      if (req.mode !== 'raw') {
        const ps = Date.now();
        const langHint = translateTo || r.language;
        const ppAb = abortableSignal(LLM_TIMEOUT_MS);
        try {
          final = await postProcess(final, req.mode, settings, langHint, () => { postProcessFailed = true; }, ppAb.signal);
        } finally {
          ppAb.dispose();
        }
        console.log(`[transcribe] llm post-process mode=${req.mode}: ${Date.now() - ps}ms${postProcessFailed ? ' (FAILED → raw text)' : ''}`);
      }
      // The mode/translation silently degraded to raw/source text — flag it
      // so the renderer can warn the user instead of presenting it as success.
      const empty = !final.trim();

      const durationMs = Date.now() - t0;

      // Write the clipboard NOW (cheap, sync).
      if (settings.autoCopy || settings.autoInject) {
        try { clipboard.writeText(final); } catch {}
      }

      // Inject DIRECTLY from main when autoInject is on, instead of returning
      // to the renderer and waiting for it to call back injectText(). This
      // removes a full renderer round-trip (IPC reply → React processing →
      // IPC call) from the paste path — the Ctrl+V fires the instant Whisper
      // + cleanup finish here. The renderer skips its own injectText when it
      // sees `injected: true`, so there's no double paste.
      let injected = false;
      if (settings.autoInject && final.trim()) {
        try { await injectText(final); injected = true; }
        catch (e) { console.warn('[transcribe] main-side inject failed, renderer will retry:', e); }
      }

      // Defer the history write OFF the critical path. addHistory() does a
      // synchronous load + JSON.parse + JSON.stringify + writeFileSync of the
      // ENTIRE history file (up to 1000 entries / 500 KB+), which blocks the
      // main-process event loop for 20-100 ms — including the injectText IPC
      // the renderer fires right after this response. setImmediate runs it
      // after the IPC reply is flushed, so the paste is never delayed by disk.
      const historyEntry = {
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
      };
      setImmediate(() => {
        try { addHistory(historyEntry); }
        catch (e) { console.warn('[transcribe] deferred addHistory failed:', e); }
      });

      return {
        ok: true,
        rawText,
        finalText: final,
        detectedLanguage: r.language,
        translatedTo: translateTo || undefined,
        durationMs,
        injected,
        postProcessFailed: postProcessFailed || undefined,
        translateFailed: translateFailed || undefined,
        empty: empty || undefined,
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

    // ABORT-PREVIOUS (#6): a new interpret supersedes any still-streaming one.
    // We abort the prior controller with reason 'superseded' (its handler will
    // emit a CLEAN done sentinel for ITS OWN requestId and bail) and install
    // ours. Every per-stage deadline below chains to `reqAbort.signal` as its
    // external signal, so a supersede cancels whatever stage we're currently in.
    currentInterpretAbort?.abort('superseded');
    const reqAbort = new AbortController();
    currentInterpretAbort = reqAbort;

    const t0 = Date.now();
    let seq = 0;
    let ttfbMs: number | undefined;
    try {
      const settings = getSettings();
      const buf = Buffer.from(req.audioBase64, 'base64');
      console.log(`[interpret] received audio: ${buf.length} bytes (${req.mimeType}) → ${req.targetLang}`);
      if (buf.length < 1200) {
        throw new Error('Audio trop court / silencieux. Parlez un peu plus longtemps.');
      }

      // Fire-and-forget TLS warm-up for every origin we're about to
      // hit. Each of these 2 calls opens a TLS session that undici's
      // global agent keeps pooled for ~60 s. When we then POST to the
      // real endpoints, no TCP + TLS handshake → ~40-100 ms saved per
      // host, compounded over Whisper + translate + TTS.
      prewarmGroq(settings.groqApiKey || settings.llmApiKey || '');
      // The interpreter's translate step runs on translateBackend() — which
      // is Cerebras when that provider is selected. Warm it too.
      prewarmLlm(settings);
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
      const sttAb = abortableSignal(STT_TIMEOUT_MS, reqAbort.signal);
      let r: Awaited<ReturnType<typeof transcribeWithGroq>>;
      try {
        r = await transcribeWithGroq(buf, req.mimeType, whisperSettings, sttAb.signal);
      } finally {
        sttAb.dispose();
      }
      // Refresh the cache with whatever Whisper actually detected so
      // the NEXT call benefits from the hint. Normalized to lower-case.
      if (r.language && typeof r.language === 'string') {
        LANG_HINTS.interpret = r.language.toLowerCase();
      }
      console.log(`[interpret] whisper: ${Date.now() - t1}ms → "${r.text.slice(0, 80)}" (lang=${r.language || '?'}, hint=${hintLang || 'auto'})`);

      // Strip fillers + Whisper hallucinations before translation so the
      // target language doesn't get a translated "Merci d'avoir regardé".
      const cleaned = cleanupTranscription(r.text, r.language || hintLang);
      let rawText = cleaned;
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
      // Each sentence-sized TTS call gets its OWN deadline (so a long first
      // sentence can't starve the tail) chained to reqAbort.signal (so a
      // supersede cancels the in-flight stream). dispose() in finally always
      // clears the timer. An aborted TTS fetch throws → caught by the handler's
      // outer catch, which emits the (clean or error) done sentinel.
      const dispatchTTS = async (partial: string): Promise<void> => {
        const ttsAb = abortableSignal(TTS_TIMEOUT_MS, reqAbort.signal);
        try {
          for await (const { chunk, mime } of streamTTS(settings, partial, { language: req.targetLang, signal: ttsAb.signal })) {
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
        } finally {
          ttsAb.dispose();
        }
      };

      let translatedFull = '';
      let pending = '';
      // Queue of in-flight TTS tasks so we can await them IN ORDER
      // before emitting the final done-sentinel. We never kick off
      // more than one TTS at a time — sequential playback is the
      // desired UX (otherwise the user hears two voices overlap).
      let ttsQueue: Promise<void> = Promise.resolve();
      // First error from any ordered TTS task. Each enqueue attaches a
      // .catch so a rejected dispatch can never become an ORPHANED unhandled
      // rejection when the translate loop throws first (e.g. on supersede) and
      // the drain below is skipped. The captured error is re-thrown after the
      // drain so a genuine TTS failure still reaches the catch (→ error sentinel).
      let ttsError: unknown = null;
      const enqueueTTS = (text: string) => {
        ttsQueue = ttsQueue.then(() => dispatchTTS(text)).catch((e) => { if (ttsError === null) ttsError = e; });
      };
      let firstSentenceSent = false;

      // Global master switch — when OFF, we skip every TTS call (saves
      // API credits) and the renderer will only show the translated
      // text. The translate stream still runs because the user WANTS
      // the text.
      const speakOn = settings.speakTranslations !== false;

      // Deadline for the whole translate stream, chained to reqAbort so a
      // supersede tears it down. dispose() after the loop in all paths.
      const trAb = abortableSignal(LLM_TIMEOUT_MS, reqAbort.signal);
      try {
        for await (const delta of streamTranslate(rawText, req.targetLang, settings, r.language, trAb.signal)) {
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
              enqueueTTS(toSpeak);
            }
          }
        }
      } finally {
        trAb.dispose();
      }
      console.log(`[interpret] translate stream done in ${Date.now() - t2}ms → "${translatedFull.slice(0, 80)}"${speakOn ? '' : ' (TTS disabled)'}`);

      if (speakOn) {
        // Whatever is left in `pending` after the stream closes is the
        // tail (if we split) or the full translation (if we never hit a
        // sentence mark — one-word inputs, abbreviations, etc.).
        const tail = pending.trim();
        if (tail.length > 0) {
          enqueueTTS(tail);
        }
      }
      // If the stream produced nothing useful, fall back to the one-shot
      // translate so the user still gets the text (and audio if enabled).
      // Should be rare.
      if (!translatedFull.trim()) {
        console.warn('[interpret] translate stream produced empty output, falling back to one-shot');
        const fbAb = abortableSignal(LLM_TIMEOUT_MS, reqAbort.signal);
        let oneShot: string;
        try {
          oneShot = await translateText(rawText, req.targetLang, settings, r.language, undefined, fbAb.signal);
        } finally {
          fbAb.dispose();
        }
        if (oneShot.trim()) {
          translatedFull = oneShot;
          if (speakOn) {
            enqueueTTS(oneShot);
          }
        }
      }

      // Drain every TTS call we kicked off before signalling completion.
      await ttsQueue;
      // Re-throw a TTS failure captured on the ordered chain so it reaches
      // the catch below (→ error sentinel) instead of being silently dropped.
      if (ttsError) throw ttsError;

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
      // DISTINGUISH the abort cause via OUR request controller (more reliable
      // than sniffing the thrown error, whose shape varies by runtime):
      //   - superseded → a NEWER interpret replaced this one. Emit a CLEAN
      //     done sentinel (NO error) for THIS requestId so the renderer just
      //     finishes the old phrase quietly. Sentinels are keyed by requestId,
      //     so this never disturbs the new request's player.
      //   - timeout / any other error → emit done WITH an error so the UI warns.
      const superseded = reqAbort.signal.aborted && isSupersededReason(reqAbort.signal.reason);
      if (superseded) {
        console.warn('[interpret] superseded by a newer request — finishing old phrase quietly');
        send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true });
        return {
          ok: false,
          requestId: req.requestId,
          rawText: '',
          translatedText: '',
          durationMs: Date.now() - t0,
          error: 'superseded',
        };
      }
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
    } finally {
      // Clear our module slot iff still the current owner — a newer request
      // may have already replaced (and superseded) us, in which case it owns
      // the slot now and must not be cleared.
      if (currentInterpretAbort === reqAbort) currentInterpretAbort = null;
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
    // Warm the configured post-process LLM origin too (often Cerebras — a
    // different origin than Groq), so the dictation post-process doesn't pay
    // a cold TLS handshake on the paste path.
    prewarmLlm(settings);
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
    const req = validateSpeakRequest(rawReq);
    if (!req) {
      return { ok: false, requestId: '', error: 'invalid request' };
    }
    const sender = event.sender;
    const send = (payload: InterpretChunkEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.ON_INTERPRET_CHUNK, payload);
    };

    // ABORT-PREVIOUS (#6): a new speak supersedes any still-streaming one so we
    // don't pay for / hear two overlapping TTS streams. The prior controller is
    // aborted with reason 'superseded'; its handler emits a CLEAN done sentinel.
    currentSpeakAbort?.abort('superseded');
    const reqAbort = new AbortController();
    currentSpeakAbort = reqAbort;

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
      // Per-call TTS deadline chained to reqAbort (so a supersede cancels the
      // in-flight stream). dispose() in finally clears the timer.
      const ttsAb = abortableSignal(TTS_TIMEOUT_MS, reqAbort.signal);
      try {
        const iter = streamTTS(settings, req.text, { language: req.language, signal: ttsAb.signal });
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
      } finally {
        ttsAb.dispose();
      }
      send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true });
      return { ok: true, ttfbMs, requestId: req.requestId };
    } catch (err: any) {
      // Superseded → CLEAN done sentinel (no error) for THIS requestId so the
      // renderer finishes the old phrase quietly. Otherwise (timeout / failure)
      // emit done WITH an error so the UI warns. See INTERPRET for the rationale.
      const superseded = reqAbort.signal.aborted && isSupersededReason(reqAbort.signal.reason);
      if (superseded) {
        console.warn('[speak] superseded by a newer request — finishing old phrase quietly');
        send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true });
        return { ok: false, error: 'superseded', requestId: req.requestId };
      }
      const msg = err?.message || String(err);
      console.error('[speak] error:', msg);
      send({ requestId: req.requestId, seq: seq++, chunkBase64: '', mime: 'audio/mpeg', done: true, error: msg });
      return { ok: false, error: msg, requestId: req.requestId };
    } finally {
      // Clear our slot iff still the current owner (a newer request may already own it).
      if (currentSpeakAbort === reqAbort) currentSpeakAbort = null;
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
    translateFailed?: boolean;
  }> => {
    try {
      const req = validateListenerTranscribeRequest(rawReq);
      if (!req) {
        return { ok: false, text: '', error: 'invalid request' };
      }
      const settings = getSettings();
      const buf = Buffer.from(req.audioBase64, 'base64');
      if (buf.length < 1200) {
        return { ok: false, text: '', error: 'audio too short' };
      }
      const explicitLangL = req.sourceLang && req.sourceLang !== 'auto' ? req.sourceLang : '';
      const listenerHint = explicitLangL
        || LANG_HINTS.listener
        || (settings.language && settings.language !== 'auto' ? settings.language : '');
      const whisperSettings = listenerHint ? { ...settings, language: listenerHint } : settings;
      const sttAb = abortableSignal(STT_TIMEOUT_MS);
      let wh: Awaited<ReturnType<typeof transcribeWithGroq>>;
      try {
        wh = await transcribeWithGroq(buf, req.mimeType, whisperSettings, sttAb.signal);
      } finally {
        sttAb.dispose();
      }
      if (wh.language && typeof wh.language === 'string') {
        LANG_HINTS.listener = wh.language.toLowerCase();
      }
      // Same cleanup as the dictation/interpret pipelines so the listener
      // transcript stays free of "Merci d'avoir regardé" and "euh".
      const cleaned = cleanupTranscription(wh.text, wh.language || listenerHint);
      // Match the transcribe/interpret pipelines' truthiness exactly
      // (`!== false` applies when the flag is true OR undefined) so the
      // listener never silently skips the user's dictionary on a settings
      // object where the field is absent.
      const text = (settings.replacementsEnabled !== false && settings.replacements?.length)
        ? applyReplacements(cleaned, settings.replacements)
        : cleaned;
      if (!text.trim()) {
        return { ok: true, text: '', sourceLang: wh.language };
      }
      let translated: string | undefined;
      let translateFailed = false;
      const tgt = req.targetLang;
      // Only translate if target differs from detected source. translateText
      // never throws (it catches internally + falls back to source text), so
      // no try/catch is needed — we use its onFail callback to flag a silent
      // degradation so the contract matches the dictation pipeline.
      if (tgt && tgt !== wh.language && tgt !== listenerHint) {
        const trAb = abortableSignal(LLM_TIMEOUT_MS);
        try {
          translated = await translateText(text, tgt, settings, wh.language, () => { translateFailed = true; }, trAb.signal);
        } finally {
          trAb.dispose();
        }
        if (translateFailed) console.warn('[listener] translate degraded to source text');
      }
      return { ok: true, text, translated, sourceLang: wh.language, translateFailed: translateFailed || undefined };
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
