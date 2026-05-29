// Listener hook — real-time transcription of INBOUND audio (someone
// else's voice) so the user can *understand* a conversation they are
// not producing.
//
// Similar shape to useContinuousInterpreter but:
//   - The capture device is explicit (typically a loopback device like
//     VB-Cable Output, Stereo Mix, or a secondary microphone) so it
//     grabs the REMOTE caller's voice, not the local microphone.
//   - The outbound pipeline calls `listenerTranscribe` (one-shot
//     transcription + optional translation) instead of `interpret`
//     (which always synthesizes audio).
//   - Results bubble up as `ListenerSegment[]`, building a scrolling
//     transcript the UI renders. No FIFO player queue — text first,
//     optional TTS via a sibling call.
//
// Thresholds are slightly looser than the interpreter VAD because
// remote voices coming through VoIP codecs are quieter and have
// different noise floors than a local mic.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListenerSegment } from '../../shared/types';
import { blobToBase64 } from '../lib/blob';

export interface UseListenerOptions {
  /** Target language (ISO). Empty = no translation. */
  targetLang: () => string;
  /** Input device id (from enumerateDevices). Empty = default mic. */
  inputDeviceId: () => string | undefined;
  /** Optional source-language hint. Whisper auto-detects otherwise. */
  sourceLang?: () => string | undefined;
  /** Called on each new segment. */
  onSegment?: (seg: ListenerSegment) => void;
  /** Hard errors (device gone, permission denied). */
  onError?: (err: Error) => void;
}

export interface UseListenerHandle {
  start: () => Promise<void>;
  stop: () => void;
  isActive: boolean;
  level: number;          // live 0..1 RMS, for waveform
  segments: ListenerSegment[];
  clearSegments: () => void;
}

// Two-stage VAD: soft trigger opens the recorder optimistically so the
// first ~100 ms of speech isn't clipped by MediaRecorder spin-up; if RMS
// doesn't reach the hard threshold within CONFIRM_WINDOW_MS we discard
// silently (background noise, door, etc.). Looser than the interpreter
// thresholds because remote VoIP audio is typically quieter.
const SPEAK_SOFT_RMS = 0.012;
const SPEAK_HARD_RMS = 0.024;
const CONFIRM_WINDOW_MS = 300;
const SILENCE_END_RMS = 0.013;
// 900 ms tolerates the natural pause between a question and its answer
// in a phone conversation. 700 ms was cutting the second half off.
const SILENCE_HOLD_MS = 900;
// Reduced from 500 ms so short interjections ("oui", "yeah", "OK") survive.
const MIN_PHRASE_MS = 280;
const MAX_PHRASE_MS = 15000;

export function useListener(opts: UseListenerOptions): UseListenerHandle {
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const phraseStartAtRef = useRef<number>(0);
  const silenceSinceRef = useRef<number>(0);
  const stoppingRef = useRef<boolean>(false);
  // VAD state machine, mirrors useContinuousInterpreter.
  const phraseStateRef = useRef<'idle' | 'preroll' | 'speaking'>('idle');
  const prerollOpenedAtRef = useRef<number>(0);

  // Keep latest opts in a ref so our useCallbacks don't re-bind often.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [isActive, setIsActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [segments, setSegments] = useState<ListenerSegment[]>([]);

  const appendSegment = useCallback((seg: ListenerSegment) => {
    setSegments((prev) => [...prev, seg].slice(-200)); // keep last 200 to bound memory
    optsRef.current.onSegment?.(seg);
  }, []);

  const clearSegments = useCallback(() => setSegments([]), []);

  const shipBlob = useCallback(async (blob: Blob, mimeType: string, audioMs: number) => {
    const id = `lst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Pre-register a placeholder so the UI shows "…" while Whisper runs.
    const placeholder: ListenerSegment = {
      id, ts: Date.now(), text: '…', audioMs, speaking: true,
    };
    appendSegment(placeholder);
    try {
      const audioBase64 = await blobToBase64(blob);
      const api = (window as any).voiceink;
      const res = await api.listenerTranscribe({
        audioBase64,
        mimeType,
        targetLang: optsRef.current.targetLang(),
        sourceLang: optsRef.current.sourceLang?.(),
      });
      if (!res.ok) {
        // Replace placeholder with error note (or drop silently for empty audio).
        setSegments((prev) => prev.map((s) => s.id === id
          ? { ...s, text: res.error ? `⚠ ${res.error}` : '', speaking: false }
          : s));
        return;
      }
      if (!res.text?.trim()) {
        // Empty transcription → drop the placeholder entirely.
        setSegments((prev) => prev.filter((s) => s.id !== id));
        return;
      }
      setSegments((prev) => prev.map((s) => s.id === id ? {
        ...s,
        text: res.text,
        translated: res.translated,
        sourceLang: res.sourceLang,
        translateFailed: res.translateFailed,
        speaking: false,
      } : s));
    } catch (err: any) {
      setSegments((prev) => prev.map((s) => s.id === id
        ? { ...s, text: `⚠ ${err?.message || err}`, speaking: false }
        : s));
      optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [appendSegment]);

  const openRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    const mime = candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';
    mimeRef.current = mime || 'audio/webm';
    const rec = mime
      ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      if (!stoppingRef.current) return;
      stoppingRef.current = false;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      const audioMs = Date.now() - phraseStartAtRef.current;
      if (blob.size > 0 && audioMs >= MIN_PHRASE_MS) {
        void shipBlob(blob, mimeRef.current, audioMs);
      }
      // Re-arm a fresh recorder if still active.
      if (isActiveRef.current) openRecorder();
    };
    recRef.current = rec;
  }, [shipBlob]);

  const isActiveRef = useRef(false);
  isActiveRef.current = isActive;

  const stop = useCallback(() => {
    setIsActive(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    // Reset state so a half-armed pre-roll doesn't ship junk on the next start.
    phraseStateRef.current = 'idle';
    stoppingRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    try {
      const deviceId = optsRef.current.inputDeviceId();
      // For the listener pipeline the input is typically a loopback / VB-Cable
      // device — keeping echoCancellation OFF avoids destroying remote-VoIP
      // audio that has already been processed by the caller's stack. AGC OFF
      // for the same reason it's off elsewhere: Whisper accuracy.
      const audio: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      analyserRef.current = an;

      setIsActive(true);
      openRecorder();

      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!isActiveRef.current || !analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const x = (buf[i] - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);

        const rec = recRef.current;
        const now = Date.now();
        const state = phraseStateRef.current;

        if (rec && rec.state === 'inactive' && state === 'idle' && rms > SPEAK_SOFT_RMS) {
          // Soft trigger — open the recorder optimistically (pre-roll capture).
          phraseStartAtRef.current = now;
          silenceSinceRef.current = 0;
          prerollOpenedAtRef.current = now;
          phraseStateRef.current = 'preroll';
          try { rec.start(100); } catch { /* already started */ }
        } else if (rec && rec.state === 'recording' && state === 'preroll') {
          if (rms > SPEAK_HARD_RMS) {
            // Confirmed real speech.
            phraseStateRef.current = 'speaking';
            silenceSinceRef.current = 0;
          } else if (now - prerollOpenedAtRef.current > CONFIRM_WINDOW_MS) {
            // Soft trigger never confirmed — discard silently.
            stoppingRef.current = false;
            try { rec.stop(); } catch { /* ignore */ }
            phraseStateRef.current = 'idle';
          }
        } else if (rec && rec.state === 'recording' && state === 'speaking') {
          if (rms < SILENCE_END_RMS) {
            if (silenceSinceRef.current === 0) silenceSinceRef.current = now;
            else if (now - silenceSinceRef.current >= SILENCE_HOLD_MS && (now - phraseStartAtRef.current) >= MIN_PHRASE_MS) {
              // End of phrase — ship it.
              stoppingRef.current = true;
              phraseStateRef.current = 'idle';
              try { rec.requestData(); } catch { /* ignore */ }
              try { rec.stop(); } catch { /* ignore */ }
            }
          } else {
            silenceSinceRef.current = 0;
          }
          // Hard cap: ship even if still speaking.
          if ((now - phraseStartAtRef.current) >= MAX_PHRASE_MS) {
            stoppingRef.current = true;
            phraseStateRef.current = 'idle';
            try { rec.requestData(); } catch { /* ignore */ }
            try { rec.stop(); } catch { /* ignore */ }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err: any) {
      stop();
      optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, [openRecorder, stop]);

  useEffect(() => () => stop(), [stop]);

  return { start, stop, isActive, level, segments, clearSegments };
}

