import { useCallback, useEffect, useRef } from 'react';

/**
 * Audio recorder hook using MediaRecorder + a parallel AnalyserNode for
 * real-time RMS level (used by the waveform visualizer).
 *
 * Latency target: <1s end-to-end. We therefore keep timeslice tight and
 * stop quickly on user action.
 */
export function useAudioRecorder(opts: {
  onLevel?: (rms: number) => void;
  onStop?: (blob: Blob, mimeType: string, audioMs: number) => void;
  onError?: (err: Error) => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const mimeRef = useRef<string>('audio/webm');

  const cleanup = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (recorderRef.current) {
      try { recorderRef.current.ondataavailable = null as any; recorderRef.current.onstop = null as any; } catch {}
      recorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch {}
      ctxRef.current = null;
    }
    analyserRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    try {
      // Whisper-large-v3 was trained on relatively clean but UN-PROCESSED
      // audio. EVERY browser-level DSP we leave on hurts accuracy:
      //   - AGC pumps gain during silent gaps then clips the first phoneme
      //     of resumed speech ("ello" instead of "hello").
      //   - noiseSuppression (RNNoise) strips natural sibilants/consonants.
      //   - echoCancellation runs an adaptive far-end filter that — without
      //     a real far-end reference in a dictation flow — introduces audible
      //     artefacts and chops short attacks. Multiple field studies show
      //     it degrades Whisper WER on otherwise clean mic input.
      // Capture raw PCM at the mic's native rate; Groq resamples to 16 kHz.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      // Audio analysis for live level
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      src.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        opts.onLevel?.(Math.min(1, rms * 2.5));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // Pick best available mime
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

      // 128 kbps opus mono gives noticeably better Whisper accuracy than 96 —
      // the extra headroom preserves consonants and sibilants that Whisper
      // relies on for word boundaries.
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const audioMs = Date.now() - startedAtRef.current;
        const type = mimeRef.current.split(';')[0] || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        opts.onStop?.(blob, type, audioMs);
        cleanup();
      };

      startedAtRef.current = Date.now();
      // Timeslice of 100ms so we already have data buffered when user stops.
      rec.start(100);
    } catch (err: any) {
      cleanup();
      opts.onError?.(err);
    }
  }, [opts, cleanup]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      // Flush any audio still buffered in the encoder before stopping —
      // without requestData(), the last ~100 ms (one timeslice worth) can
      // get dropped when stop() races the encoder, which is exactly the
      // tail of the user's utterance.
      try { rec.requestData(); } catch {}
      try { rec.stop(); } catch {}
    } else {
      cleanup();
    }
  }, [cleanup]);

  const isRecording = useCallback(() => {
    const rec = recorderRef.current;
    return !!rec && rec.state === 'recording';
  }, []);

  return { start, stop, isRecording };
}
