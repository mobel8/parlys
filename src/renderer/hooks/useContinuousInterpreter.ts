// Continuous interpreter hook — Voice Activity Detection (VAD)
// pipeline for the "simultaneous interpretation" mode.
//
// High-level flow:
//   1. Open a single MediaStream + AudioContext with an AnalyserNode
//      that samples the microphone RMS every ~30 ms.
//   2. A simple state machine tracks speaking vs. silent:
//        - RMS > speakStart threshold → start a MediaRecorder, open a
//          new "phrase" window.
//        - RMS < silenceEnd threshold for `silenceHoldMs` consecutive
//          ms → stop the MediaRecorder, ship the WebM blob off to the
//          `interpret` IPC, then get ready for the next phrase.
//   3. Each phrase feeds its own `InterpretPlayer`, but we serialize
//      playback through a strict FIFO queue: only ONE player speaks
//      at a time. Player N+1 buffers its MP3 chunks in its own
//      MediaSource (so translation keeps happening in parallel) but
//      waits for player N to emit `ended` before it gets `.start()`ed.
//      This is what the user hears as "consecutive translation":
//      phrase A → pause → phrase B → pause → phrase C, never overlapping.
//
// The thresholds are deliberately conservative — we'd rather keep a
// tiny bit of silence at the ends than clip the beginning of a word.
// Users can later tune them from SettingsView if needed.

import { useCallback, useEffect, useRef } from 'react';
import { InterpretPlayer, InterpretPlayerQueue } from '../lib/interpret-player';
import { blobToBase64 } from '../lib/blob';
import type { InterpretChunkEvent, InterpretResponse } from '../../shared/types';

export interface ContinuousInterpreterOptions {
  /** Target language (ISO 639-1). Read every time a phrase is shipped. */
  targetLang: () => string;
  /** Source language hint (or empty for auto-detect). */
  sourceLang: () => string | undefined;
  /** Output device id for the TTS player. Read on each phrase. */
  sinkId?: () => string | undefined;
  /**
   * Global master switch: when this getter returns false we skip
   * every audio-playback side-effect (no InterpretPlayer, no
   * MediaSource) — matching the main process which won't send any
   * MP3 chunks either. Translate + onPhraseDone still fire so the
   * UI can display the text.
   */
  speakEnabled?: () => boolean;
  /** Called when a new live RMS sample arrives (0..1), for waveform UI. */
  onLevel?: (rms: number) => void;
  /** Fired when a new phrase is detected and TTS audio starts playing. */
  onPhraseStart?: (meta: { requestId: string }) => void;
  /** Fired when a phrase round-trip completes with metadata. */
  onPhraseDone?: (res: InterpretResponse) => void;
  /** Fired on any hard error (permission denied, stream broken, TTS…). */
  onError?: (err: Error) => void;
}

export interface ContinuousInterpreterHandle {
  start: () => Promise<void>;
  stop: () => void;
  isActive: () => boolean;
}

// Tunables. Refined empirically — hold short enough for snappy
// interpretation (~500 ms feels "live"), RMS gap loose enough to
// tolerate soft speakers.
const SPEAK_START_RMS = 0.035;
const SILENCE_END_RMS = 0.02;
const SILENCE_HOLD_MS = 600;
/** Minimum phrase length before we bother shipping it — avoids firing
 *  interpret for 'ah' or a single clipped consonant. */
const MIN_PHRASE_MS = 400;
/** Hard cap on a single phrase, to protect API limits and avoid huge
 *  latency spikes on monologues. 18 s covers most sentences. */
const MAX_PHRASE_MS = 18000;

export function useContinuousInterpreter(opts: ContinuousInterpreterOptions): ContinuousInterpreterHandle {
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const phraseStartAtRef = useRef<number>(0);
  const silenceSinceRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);
  const stoppingForShipRef = useRef<boolean>(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  /**
   * Strict-FIFO queue of players. See `InterpretPlayerQueue` for the
   * serialization guarantee — only one player speaks at a time, the
   * rest buffer silently until their turn.
   *
   * Constructed lazily on first render so `optsRef` is already set by
   * the time the queue's error hook reads it.
   */
  const queueRef = useRef<InterpretPlayerQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new InterpretPlayerQueue((err) => optsRef.current.onError?.(err));
  }

  // Wire a single chunk listener that routes to the queue; the queue
  // forwards each chunk to its matching player by requestId.
  useEffect(() => {
    const api = (window as any).voiceink;
    if (!api?.onInterpretChunk) return;
    const unsub = api.onInterpretChunk((evt: InterpretChunkEvent) => {
      queueRef.current?.route(evt);
    });
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, []);

  const shipCurrentPhrase = useCallback((reason: 'silence' | 'cap' | 'force') => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    const phraseMs = Date.now() - phraseStartAtRef.current;
    if (phraseMs < MIN_PHRASE_MS && reason === 'silence') {
      // Too short — drop and start fresh next time speech is detected.
      try { rec.stop(); } catch { /* ignore */ }
      recorderRef.current = null;
      chunksRef.current = [];
      return;
    }
    stoppingForShipRef.current = true;
    try { rec.stop(); } catch { /* ignore */ }
  }, []);

  const shipBlob = useCallback(async (blob: Blob, mimeType: string) => {
    const requestId = `intc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queue = queueRef.current!;
    // Master mute — if the user disabled spoken output, we still ship
    // the phrase (translate + onPhraseDone text) but we DO NOT build a
    // player. No MediaSource is opened, no chunks are consumed, and
    // the main process won't send any either. Saves work on both sides.
    const speakOn = optsRef.current.speakEnabled ? optsRef.current.speakEnabled() : true;
    let player: InterpretPlayer | null = null;
    if (speakOn) {
      // Build the player in "held" mode — it will buffer MP3 chunks
      // but stay silent until the queue authorizes playback. This is
      // what prevents phrase N+1 from talking over phrase N.
      player = new InterpretPlayer(requestId, {
        onEnd: () => { if (player) queue.advance(player); },
        onError: (err) => {
          optsRef.current.onError?.(err);
          if (player) queue.advance(player);
        },
      }, { sinkId: optsRef.current.sinkId?.(), autoStart: false });
      queue.add(player);
    }
    optsRef.current.onPhraseStart?.({ requestId });
    try {
      const audioBase64 = await blobToBase64(blob);
      const api = (window as any).voiceink;
      const res = await api.interpret({
        requestId,
        audioBase64,
        mimeType,
        sourceLang: optsRef.current.sourceLang(),
        targetLang: optsRef.current.targetLang(),
      });
      optsRef.current.onPhraseDone?.(res);
      if (!res.ok) {
        // Surface error, tear down this player and advance the queue
        // so the next phrase doesn't stall behind a broken one.
        optsRef.current.onError?.(new Error(res.error || 'Interpret failed'));
        if (player) { player.dispose(); queue.advance(player); }
      }
    } catch (err: any) {
      optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      if (player) { player.dispose(); queue.advance(player); }
    }
  }, []);

  const openRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    let mime = '';
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) { mime = c; break; }
    }
    mimeRef.current = mime || 'audio/webm';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = mimeRef.current.split(';')[0] || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      recorderRef.current = null;
      if (stoppingForShipRef.current && blob.size > 1000) {
        stoppingForShipRef.current = false;
        shipBlob(blob, type);
      }
      stoppingForShipRef.current = false;
    };
    recorderRef.current = rec;
    phraseStartAtRef.current = Date.now();
    silenceSinceRef.current = 0;
    rec.start(100);
  }, [shipBlob]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    streamRef.current = stream;

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    src.connect(analyser);
    analyserRef.current = analyser;

    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!activeRef.current || !analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      optsRef.current.onLevel?.(Math.min(1, rms * 2.5));
      const now = Date.now();

      const rec = recorderRef.current;
      const isRecording = !!rec && rec.state === 'recording';

      if (!isRecording) {
        if (rms > SPEAK_START_RMS) {
          openRecorder();
        }
      } else {
        // Inside a phrase — track silence.
        if (rms < SILENCE_END_RMS) {
          if (silenceSinceRef.current === 0) silenceSinceRef.current = now;
          if (now - silenceSinceRef.current >= SILENCE_HOLD_MS) {
            shipCurrentPhrase('silence');
          }
        } else {
          silenceSinceRef.current = 0;
        }
        // Hard cap.
        if (now - phraseStartAtRef.current >= MAX_PHRASE_MS) {
          shipCurrentPhrase('cap');
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [openRecorder, shipCurrentPhrase]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    // Ship any phrase still in progress so the user doesn't lose audio.
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      const phraseMs = Date.now() - phraseStartAtRef.current;
      if (phraseMs >= MIN_PHRASE_MS) {
        stoppingForShipRef.current = true;
      }
      try { rec.stop(); } catch { /* ignore */ }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* ignore */ }
      ctxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Tidy up on unmount.
  useEffect(() => () => stop(), [stop]);

  const isActive = useCallback(() => activeRef.current, []);

  return { start, stop, isActive };
}
