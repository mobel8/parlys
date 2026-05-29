import { useCallback, useEffect, useRef } from 'react';

/**
 * Audio recorder built on a CONTINUOUS PCM RING BUFFER (not MediaRecorder).
 *
 * WHY PCM AND NOT MediaRecorder
 * ------------------------------
 * The goal: never lose the start of a phrase, even when the user starts
 * talking BEFORE/AS they press the shortcut. That needs a pre-roll — audio
 * captured from BEFORE the press. MediaRecorder produces webm, whose chunks
 * can't be sliced/concatenated (the init segment embeds the first ~250 ms of
 * audio, so any ring-buffer slice prepends a stale snippet). Raw PCM has no
 * such constraint: it's just samples, trivially sliceable to the exact
 * pre-roll boundary.
 *
 * HOW IT WORKS
 * ------------
 * - On mount we acquire the mic ONCE (warm — no cold getUserMedia on the hot
 *   path) and wire a ScriptProcessorNode that copies every input frame into a
 *   circular Int16 ring buffer, continuously, for as long as the app runs.
 * - `start()` just records the current write position minus the pre-roll
 *   window — instant, no device spin-up, no recorder construction.
 * - `stop()` slices the ring from (start − pre-roll) to now, encodes a WAV,
 *   and ships it. The first ~1 s the user spoke is always in there.
 *
 * ScriptProcessorNode is deprecated but the only CSP-safe continuous-capture
 * primitive here (AudioWorklet needs addModule(blobURL), which our
 * `script-src 'self'` CSP blocks). The callback only copies samples, so its
 * main-thread cost is negligible.
 *
 * Trade-off: the mic is held open the whole session (OS mic indicator on).
 * That's the price of a guaranteed-intact phrase start (Superwhisper does the
 * same). Released on unmount.
 */

const PREROLL_MS = 1000;       // capture this much audio from BEFORE the press
const RING_SECONDS = 120;      // max single-phrase length we can hold
const PROCESSOR_FRAMES = 2048; // ScriptProcessor buffer (~43 ms @ 48k)

/**
 * Integer-factor downsample toward 16 kHz (Whisper's native rate) to cut the
 * WAV upload size ~3x vs 48 kHz. The box-filter average over `factor` samples
 * doubles as a cheap anti-alias low-pass, which is plenty for speech.
 *
 * NOTE: integer-factor only. A 48 kHz device → factor 3 → exactly 16 kHz. A
 * 44.1 kHz device (some macOS/Windows drivers ignore the 48k hint) → factor 3
 * → 14.7 kHz, slightly under Whisper's 16 kHz — a minor, inaudible headroom
 * loss for speech, never a pitch/playback error (the WAV header carries the
 * honest output rate). A fractional resampler would be needed for exact 16k
 * from 44.1k; not worth the complexity here.
 */
function downsampleToward16k(input: Int16Array, inRate: number): { data: Int16Array; rate: number } {
  const target = 16000;
  if (inRate <= target + 1000) return { data: input, rate: inRate };
  const factor = Math.round(inRate / target);
  if (factor <= 1) return { data: input, rate: inRate };
  const outLen = Math.floor(input.length / factor);
  const out = new Int16Array(outLen);
  for (let j = 0; j < outLen; j++) {
    let sum = 0;
    const base = j * factor;
    for (let k = 0; k < factor; k++) sum += input[base + k];
    out[j] = (sum / factor) | 0;
  }
  return { data: out, rate: Math.round(inRate / factor) };
}

function encodeWavMono16(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);            // PCM fmt chunk size
  view.setUint16(20, 1, true);             // audio format = PCM
  view.setUint16(22, 1, true);             // channels = mono
  view.setUint32(24, sampleRate, true);    // sample rate
  view.setUint32(28, sampleRate * 2, true);// byte rate (mono 16-bit)
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  // Bulk-copy the PCM payload with a single typed-array set (memcpy speed)
  // instead of ~n DataView.setInt16 calls. Electron only ever runs on
  // little-endian x86/ARM and the WAV data chunk is LE, so a direct
  // Int16Array view over the buffer is byte-correct. This matters because
  // encode runs synchronously in stop() on the main thread while the user
  // waits to paste — a 10 s phrase is ~160k samples, a 120 s one ~1.9M.
  new Int16Array(buf, 44).set(samples);
  return buf;
}

export function useAudioRecorder(opts: {
  onLevel?: (rms: number) => void;
  onStop?: (blob: Blob, mimeType: string, audioMs: number) => void;
  onError?: (err: Error) => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const warmingRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  // Ring buffer (Int16) + monotonically increasing absolute write counter.
  const ringRef = useRef<Int16Array | null>(null);
  const ringLenRef = useRef<number>(0);
  const writeCountRef = useRef<number>(0);     // total samples ever written
  const sampleRateRef = useRef<number>(48000);

  // Capture session.
  const capturingRef = useRef(false);
  const captureStartRef = useRef<number>(0);    // absolute sample index

  const ensureWarm = useCallback(async (): Promise<void> => {
    if (streamRef.current && streamRef.current.active && procRef.current) return;
    if (warmingRef.current) return warmingRef.current;
    warmingRef.current = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const sr = ctx.sampleRate || 48000;
      sampleRateRef.current = sr;
      ringLenRef.current = Math.floor(sr * RING_SECONDS);
      ringRef.current = new Int16Array(ringLenRef.current);
      writeCountRef.current = 0;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const proc = ctx.createScriptProcessor(PROCESSOR_FRAMES, 1, 1);
      procRef.current = proc;
      // Zero-gain sink: ScriptProcessor only fires onaudioprocess while it's
      // connected to the destination, but we must NOT route the mic to the
      // speakers (feedback). A gain=0 node in between mutes the output.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sinkRef.current = sink;

      proc.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        const ring = ringRef.current;
        const ringLen = ringLenRef.current;
        if (!ring || ringLen === 0) return;
        // Only accumulate RMS while capturing. The mic stays open the whole
        // session (continuous ring), so this callback fires forever — and the
        // recorder is idle far more than it captures. Gating the multiply-add
        // keeps the steady-state idle path to just the Int16 write.
        const capturing = capturingRef.current;
        let sumSq = 0;
        let wc = writeCountRef.current;
        for (let i = 0; i < input.length; i++) {
          const s = input[i];
          if (capturing) sumSq += s * s;
          // Float[-1,1] → Int16
          let v = s < 0 ? s * 0x8000 : s * 0x7fff;
          if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
          ring[wc % ringLen] = v;
          wc++;
        }
        writeCountRef.current = wc;
        if (capturing) {
          const rms = Math.sqrt(sumSq / input.length);
          optsRef.current.onLevel?.(Math.min(1, rms * 2.5));
        }
      };

      source.connect(proc);
      proc.connect(sink);
      sink.connect(ctx.destination);
      try { (window as any).voiceink?.prewarm?.(); } catch { /* best-effort */ }
    })();
    try {
      await warmingRef.current;
    } catch (err) {
      streamRef.current = null;
      throw err;
    } finally {
      warmingRef.current = null;
    }
  }, []);

  const release = useCallback(() => {
    capturingRef.current = false;
    if (procRef.current) { try { procRef.current.onaudioprocess = null as any; procRef.current.disconnect(); } catch {} procRef.current = null; }
    if (sinkRef.current) { try { sinkRef.current.disconnect(); } catch {} sinkRef.current = null; }
    if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch {} sourceRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} ctxRef.current = null; }
    ringRef.current = null;
  }, []);

  // Warm on mount, keep warm the whole session (no idle release — that was
  // the cause of the intermittent "pas du tout" cold starts). Re-warm on
  // focus/visibility if the stream ever died.
  useEffect(() => {
    mountedRef.current = true;
    void ensureWarm().catch(() => { /* retried on start() */ });
    const onShow = () => { if (document.visibilityState === 'visible') void ensureWarm().catch(() => {}); };
    window.addEventListener('focus', onShow);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('focus', onShow);
      document.removeEventListener('visibilitychange', onShow);
      release();
    };
  }, [ensureWarm, release]);

  const start = useCallback(async () => {
    try {
      await ensureWarm();
      if (!ringRef.current) throw new Error('Microphone indisponible');
      const prerollSamples = Math.floor(sampleRateRef.current * PREROLL_MS / 1000);
      // Capture from (now − pre-roll), clamped so we never read before the
      // ring's oldest valid sample.
      const oldest = Math.max(0, writeCountRef.current - ringLenRef.current);
      captureStartRef.current = Math.max(oldest, writeCountRef.current - prerollSamples);
      capturingRef.current = true;
    } catch (err: any) {
      capturingRef.current = false;
      optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [ensureWarm]);

  const stop = useCallback(() => {
    if (!capturingRef.current) return;
    capturingRef.current = false;
    const ring = ringRef.current;
    const ringLen = ringLenRef.current;
    if (!ring || ringLen === 0) return;
    const endAbs = writeCountRef.current;
    // CRITICAL: re-clamp the start to the ring's CURRENT oldest valid sample.
    // captureStartRef was clamped at start() time, but for a capture longer
    // than RING_SECONDS the ring has since wrapped and overwritten those
    // slots. Reading from the stale absolute index would walk the ring at the
    // wrong phase → temporally scrambled / garbled audio. Clamping here makes
    // an over-length capture cleanly return the most-recent RING_SECONDS in
    // correct chronological order. count <= ringLen by construction.
    const startAbs = Math.max(captureStartRef.current, endAbs - ringLen);
    const count = endAbs - startAbs;
    // Skip trivially short captures (accidental tap / stop-right-after-start).
    // With the 1 s pre-roll a truly empty blob is rare, but a sub-250 ms slice
    // is noise — shipping it wastes a Whisper call and can surface a
    // hallucinated result. Mirrors MIN_PHRASE_MS in the sibling pipelines.
    const sr = sampleRateRef.current;
    const audioMs = Math.round((count / sr) * 1000);
    if (count === 0 || audioMs < 250) return;
    // Extract the slice with at most two memcpy-speed subarray copies instead
    // of a per-sample modulo loop (this runs on the main thread in stop()).
    const pcm = new Int16Array(count);
    const r = startAbs % ringLen;
    if (r + count <= ringLen) {
      pcm.set(ring.subarray(r, r + count));
    } else {
      const first = ringLen - r;
      pcm.set(ring.subarray(r));
      pcm.set(ring.subarray(0, count - first), first);
    }
    // Downsample toward 16 kHz before encoding — smaller upload, zero quality
    // loss for Whisper (it resamples to 16 kHz internally anyway).
    const { data: ds, rate: dsRate } = downsampleToward16k(pcm, sr);
    const wav = encodeWavMono16(ds, dsRate);
    const blob = new Blob([wav], { type: 'audio/wav' });
    optsRef.current.onStop?.(blob, 'audio/wav', audioMs);
  }, []);

  const isRecording = useCallback(() => capturingRef.current, []);

  // Suspend/resume the warm pipeline. Used when ANOTHER mic pipeline (the
  // continuous interpreter) is active, so we don't run two AudioContexts +
  // two getUserMedia streams on the same device simultaneously (WASAPI
  // contention + wasted CPU). suspend() pauses the AudioContext (stops the
  // onaudioprocess ring writes) without releasing the device; resume()
  // restarts it. No-op if not warm or already in the target state.
  const suspend = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === 'running') { try { void ctx.suspend(); } catch { /* ignore */ } }
  }, []);
  const resume = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === 'suspended') { try { void ctx.resume(); } catch { /* ignore */ } }
  }, []);

  return { start, stop, isRecording, suspend, resume };
}
