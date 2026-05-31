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
  /**
   * Fired on a NON-fatal degradation that must be shown to the user but
   * must NOT skip/tear down the phrase — currently an audio-output
   * routing failure (`setSinkId` rejected, so the translated voice plays
   * on the default device instead of the requested virtual mic). Unlike
   * `onError`, this does NOT advance the playback queue.
   */
  onWarning?: (msg: string) => void;
}

export interface ContinuousInterpreterHandle {
  start: () => Promise<void>;
  stop: () => void;
  isActive: () => boolean;
}

// Two-stage VAD with a soft/hard threshold pair gives us natural pre-roll:
// the recorder opens on the soft trigger so MediaRecorder's ~50-100 ms
// spin-up overlaps with the user's first phoneme instead of clipping it.
// If RMS doesn't reach the hard threshold within CONFIRM_WINDOW_MS we
// silently discard (door slams, keyboard clicks, etc.) so we don't ship
// junk to Whisper.
const SPEAK_SOFT_RMS = 0.018;       // open recorder optimistically
const SPEAK_HARD_RMS = 0.032;       // confirm it's actual speech
const CONFIRM_WINDOW_MS = 280;      // soft → hard must happen within this
const SILENCE_END_RMS = 0.018;
// 850 ms tolerates the natural inter-clause pause in French/English speech.
// 600 ms was cutting "X, … et Y" right after the comma.
const SILENCE_HOLD_MS = 850;
/** Minimum phrase length before we bother shipping it. Dropped from 400 ms
 *  to 220 ms so short legitimate answers like "oui", "non", "OK" survive. */
const MIN_PHRASE_MS = 220;
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
  // 'idle' = no recorder; 'preroll' = recorder open, awaiting hard confirm;
  // 'speaking' = confirmed phrase in progress.
  const phraseStateRef = useRef<'idle' | 'preroll' | 'speaking'>('idle');
  const prerollOpenedAtRef = useRef<number>(0);

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
      phraseStateRef.current = 'idle';
      return;
    }
    stoppingForShipRef.current = true;
    // Flush encoder so the tail of the phrase isn't dropped between the
    // last 100 ms timeslice and stop().
    try { rec.requestData(); } catch { /* ignore */ }
    try { rec.stop(); } catch { /* ignore */ }
    phraseStateRef.current = 'idle';
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
        // Non-fatal output-routing failure — warn the user but keep the
        // phrase playing (on the default device). Do NOT advance/dispose.
        onSinkError: (err) => optsRef.current.onWarning?.(err.message),
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
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = mimeRef.current.split(';')[0] || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      recorderRef.current = null;
      // Don't build a player / ship after the hook was torn down (stop()
      // sets activeRef=false). A late onstop firing post-unmount would
      // otherwise spawn an InterpretPlayer/MediaSource on a dead component.
      if (stoppingForShipRef.current && blob.size > 1000 && activeRef.current) {
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
    // Acquire the mic BEFORE flipping activeRef. If getUserMedia throws
    // (permission denied / no device), activeRef must stay false — otherwise
    // the next click hits the `if (activeRef.current) return` guard and
    // silently no-ops forever (the app appears bricked with zero feedback).
    // See useAudioRecorder for the DSP-off rationale.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    } catch (err) {
      activeRef.current = false;
      throw err; // surfaced by MainView.toggle()'s catch
    }
    activeRef.current = true;
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
      const state = phraseStateRef.current;

      if (!isRecording || state === 'idle') {
        // Soft trigger: open recorder optimistically to capture pre-roll.
        if (rms > SPEAK_SOFT_RMS) {
          openRecorder();
          prerollOpenedAtRef.current = now;
          phraseStateRef.current = 'preroll';
        }
      } else if (state === 'preroll') {
        if (rms > SPEAK_HARD_RMS) {
          // Confirmed real speech — promote to 'speaking'.
          phraseStateRef.current = 'speaking';
          // Reset silence accounting now that we're in a real phrase.
          silenceSinceRef.current = 0;
        } else if (now - prerollOpenedAtRef.current > CONFIRM_WINDOW_MS) {
          // No confirmed speech — discard silently. NOT shipped.
          stoppingForShipRef.current = false;
          try { rec!.stop(); } catch { /* ignore */ }
          recorderRef.current = null;
          chunksRef.current = [];
          phraseStateRef.current = 'idle';
        }
      } else {
        // 'speaking' — track silence.
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
    // Ship any CONFIRMED phrase still in progress so the user doesn't lose audio.
    // We deliberately don't ship 'preroll' state — that's by definition not yet
    // confirmed speech, and shipping it just feeds Whisper unintelligible blips.
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      if (phraseStateRef.current === 'speaking') {
        const phraseMs = Date.now() - phraseStartAtRef.current;
        if (phraseMs >= MIN_PHRASE_MS) {
          stoppingForShipRef.current = true;
          try { rec.requestData(); } catch { /* ignore */ }
        }
      }
      try { rec.stop(); } catch { /* ignore */ }
    }
    // Defensively null the recorder ref rather than relying solely on the
    // async onstop (which may not fire once the tracks are cut below).
    recorderRef.current = null;
    phraseStateRef.current = 'idle';
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* ignore */ }
      ctxRef.current = null;
    }
    analyserRef.current = null;
    // Tear down every queued/playing InterpretPlayer (MediaSource + <audio> +
    // MP3 buffers). Without this they linger until GC and a player can keep
    // speaking after capture stopped.
    try { queueRef.current?.disposeAll(); } catch { /* ignore */ }
  }, []);

  // Tidy up on unmount.
  useEffect(() => () => stop(), [stop]);

  const isActive = useCallback(() => activeRef.current, []);

  return { start, stop, isActive };
}
