import { useCallback, useEffect, useRef } from 'react';
import {
  analyzeSpeech,
  analyzeFrameSeries,
  trimToSpeech,
  speechMetaFor,
  SpeechAnalysis,
  SpeechMeta,
} from '../../shared/speech-gate';

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
 * - `stop()` slices the ring from (start − pre-roll) to now, gates + trims
 *   it (speech-gate), encodes a WAV, and ships it.
 *
 * LIVENESS / SELF-HEAL (the "zombie mic" fix)
 * -------------------------------------------
 * A warm pipeline can die SILENTLY: after Windows sleep/resume, an audio
 * device change, or a driver reset, `stream.active` stays true and the
 * AudioContext often still claims 'running' — but onaudioprocess stops
 * firing forever. Symptoms in production: "je parle et rien n'est détecté",
 * fixed only by recreating the window (density swap). Worse, stop() then
 * sliced a STALE pre-roll (writeCount frozen) and shipped old ring content
 * to Whisper → hallucinated words ("Merci.") the user never said.
 *
 * The cure is to treat "samples are actually arriving" as the ONLY truth:
 *   - every onaudioprocess stamps `lastTickAt`;
 *   - `start()` runs ensureLive(): fresh tick → go; stale → resume() the
 *     ctx, wait a beat, else full rebuild (release + re-getUserMedia),
 *     and only returns once ticks are CONFIRMED flowing;
 *   - a 2 s watchdog heals in the background (so the pre-roll is already
 *     warm again by the time the user presses), detects mid-capture
 *     stalls, dead streams (stopped tracks keep ticking zeros — liveness
 *     alone can't see those) and wall-clock jumps (= machine slept);
 *   - track 'ended'/persistent-'mute', devicechange and the main-process
 *     `systemResumed` broadcast trigger targeted rebuilds.
 * Rebuilds reset the ring (writeCount=0), so a healed pipeline can never
 * ship pre-death stale audio. `rebuild()` is the ONLY destructive path and
 * preserves an in-flight capture by re-anchoring it on the fresh ring.
 *
 * Test/diagnostic hooks (see `loadRenderer` in src/main/index.ts):
 *   - URL hash `;audioheal=0` (env PARLYS_AUDIO_HEAL=0) disables all healing
 *     — the legacy behaviour, kept for A/B-proving the fix;
 *   - URL hash `;audit=1` (env PARLYS_AUDIT=1) exposes
 *     `window.__parlysAudioAudit` (state introspection + pipeline-kill
 *     simulators) for the CDP e2e harness.
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
/**
 * Max single-dictation length the ring can hold. 300 s (was 120): the user
 * dictates multi-minute monologues, and a capture longer than the ring
 * SILENTLY LOSES ITS BEGINNING (sliceRing clamps to the most-recent
 * RING_SECONDS — proven live: a 218 s capture shipped exactly 120 000 ms,
 * first sentences gone). 300 s × 48 kHz × 2 B = 28.8 MB preallocated, and
 * the shipped 16 kHz WAV stays ≈ 9.6 MB, well under Groq's 25 MB cap.
 * Beyond 300 s the clamp still applies but is now DETECTED and surfaced
 * (stats.truncatedMs → UI warning) instead of being silent.
 */
const RING_SECONDS = 300;
const PROCESSOR_FRAMES = 2048; // ScriptProcessor buffer (~43 ms @ 48k)

// --- Liveness / self-heal tuning -------------------------------------------
// Ticks arrive every ~43 ms while the graph is alive, so "fresh" can be tight.
const TICK_FRESH_MS = 450;       // a tick within this window = pipeline alive
const START_CONFIRM_MS = 350;    // start(): max wait for a tick before rebuilding
const REBUILD_CONFIRM_MS = 1500; // max wait for the FIRST tick after a rebuild
const WATCHDOG_EVERY_MS = 2000;
const IDLE_STALE_MS = 3500;      // idle: no tick for this long → heal
const CAPTURE_STALE_MS = 2000;   // capturing: no tick for this long → heal
const CLOCK_JUMP_MS = 10000;     // watchdog gap ≫ interval → machine slept
const REBUILD_FAIL_BACKOFF_MS = 8000; // don't hammer getUserMedia when it fails
const MUTE_PERSIST_MS = 1500;    // 'mute' older than this → device is stuck, rebuild
const MIN_CLIP_MS = 250;         // shorter than this = accidental tap, drop

// --- Speculative transcription -----------------------------------------
// While the user is STILL recording, the checker below watches the
// incrementally-built frame series; once it sees ≥ SPEC_SILENCE_MS of
// silence after real speech, the recorder slices/encodes the clip up to
// the end of speech and hands it to onSpeculativeReady — the view fires
// the full transcription pipeline in the background (zero side effects).
// If the user then presses stop WITHOUT having spoken again (the normal
// end-of-dictation gesture: finish the phrase, reach for the key), the
// final clip is byte-identical to the speculated one → the view commits
// the parked result and the paste is near-instant. If the user resumed
// speaking, the speech end moved → the speculation is invalid → classic
// path, exactly as today.
const SPEC_CHECK_EVERY_MS = 180;  // checker cadence while capturing
const SPEC_SILENCE_MS = 600;      // trailing silence that triggers a fire
// |specEnd − finalEnd| ≤ this at stop → same utterance, commit is safe. A
// genuine resume moves the end by ≥ SPEC_SILENCE_MS + a word (≫ 800 ms);
// what this tolerance absorbs is adaptive-threshold drift re-classifying
// the LAST frames of the SAME utterance as silence accumulates (the audio
// within the tolerance is inside the 320 ms tail margin either way).
const SPEC_TOL_MS = 250;
// Dedupe window for FIRING: don't re-speculate while the measured speech
// end wobbles around the same utterance end (each refire = a wasted API
// call). Kept wider than SPEC_TOL_MS: a suppressed refire at worst costs a
// classic-path stop, never a wrong paste.
const SPEC_DEDUPE_MS = 400;
const SPEC_MIN_FRAMES = 20;       // don't even analyze under ~600 ms captured
/**
 * Don't fire speculations once the capture exceeds this. Every fire
 * uploads the WHOLE clip-so-far: on a multi-minute dictation with pauses
 * that used to mean dozens of increasingly heavy Whisper calls (rate-limit
 * pressure + cost) for a shrinking latency benefit. Long dictations take
 * the classic path at stop, exactly as with speculation disabled.
 */
const SPEC_MAX_CLIP_MS = 45_000;

/** Stats shipped alongside the WAV so the caller can log/inspect quality. */
export interface CaptureStats {
  /** Full captured duration (incl. pre-roll), before trimming. */
  totalMs: number;
  /** Cumulative speech-classified time (30 ms frames above threshold). */
  speechMs: number;
  /** Duration actually shipped after head/tail silence trim. */
  shippedMs: number;
  noiseFloor: number;
  peakRms: number;
  /**
   * Client speech geometry relative to the shipped clip — forwarded to the
   * server so the hallucination filter can cross-check Whisper timestamps.
   */
  speechMeta?: SpeechMeta | null;
  /**
   * Set on onStop when a speculative transcription fired for THIS exact
   * utterance (speech end unchanged since the fire): the view should
   * commit `spec.id` instead of re-transcribing.
   */
  spec?: { id: string } | null;
  /**
   * > 0 when the capture outgrew the ring and its BEGINNING was clamped
   * away (how many ms were lost). The views surface a warning so the
   * loss is never silent again.
   */
  truncatedMs?: number;
}

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
  onStop?: (blob: Blob, mimeType: string, audioMs: number, stats?: CaptureStats) => void;
  /**
   * A stop() that decided NOT to ship (no speech detected, dead mic, clip
   * too short). The view MUST leave its 'recording' state here — before
   * this callback existed, those paths returned silently and the pill
   * stayed red forever on a dead pipeline.
   */
  onDrop?: (reason: string) => void;
  onError?: (err: Error) => void;
  /**
   * Fired mid-capture when the user has been silent ≥ SPEC_SILENCE_MS after
   * speaking: `blob` is the clip up to the end of speech, encoded exactly
   * like a stop() ship. The view should launch a SPECULATIVE transcription
   * (speculative: true, specId) — see CaptureStats.spec for the commit
   * handshake at stop time. May fire again if the user resumes then pauses.
   */
  onSpeculativeReady?: (
    blob: Blob, mimeType: string, audioMs: number, stats: CaptureStats, specId: string,
  ) => void;
  /** Master switch from settings (speculativeStt). Default true. */
  speculative?: boolean;
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

  // Liveness bookkeeping. Date.now() (wall clock) everywhere: it jumps
  // forward across system sleep — exactly the signal the watchdog wants —
  // whereas performance.now() may pause during suspend on Windows.
  const lastTickAtRef = useRef<number>(0);     // stamp of last onaudioprocess
  const tickCountRef = useRef<number>(0);      // total callbacks ever fired
  const rebuildsRef = useRef<number>(0);       // heal counter (diagnostics)
  const lastRebuildFailAtRef = useRef<number>(0);
  const rebuildingRef = useRef<Promise<void> | null>(null);
  const suspendedByAppRef = useRef(false);     // interpreter owns the device
  const muteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRmsRef = useRef<number>(0);        // audit-only observability

  // Behaviour flags baked into the URL hash by main (see loadRenderer).
  // Segment-shaped (`;key=value`) per the hash-parsing lesson in
  // tasks/lessons.md — substring checks against the full segment literal.
  const hash = typeof location !== 'undefined' ? location.hash || '' : '';
  const healEnabledRef = useRef(!hash.includes(';audioheal=0'));
  const auditRef = useRef(hash.includes(';audit=1'));
  // env PARLYS_SPECULATIVE=0 → ';spec=0' → hard-disable (A/B benches).
  const specHashDisabledRef = useRef(hash.includes(';spec=0'));

  // --- Speculative capture state ----------------------------------------
  // Incremental 30 ms frame-RMS series for the CURRENT capture (starts at
  // the press — the pre-roll is not part of it). Built inside
  // onaudioprocess for ~2 flops/sample, consumed by the checker interval.
  const capFramesRef = useRef<{ originAbs: number; rms: number[]; acc: number; accN: number }>(
    { originAbs: -1, rms: [], acc: 0, accN: 0 },
  );
  const frameLenRef = useRef<number>(1440); // samples per 30 ms frame (set per ctx rate)
  const captureIdRef = useRef<string>('');
  const specSeqRef = useRef(0);
  // Last fired speculation: endAbs = ABSOLUTE ring sample index of the end
  // of qualified speech in the speculated clip (full-slice coordinates).
  const lastSpecRef = useRef<{ id: string; endAbs: number; firedAt: number } | null>(null);
  const specBusyRef = useRef(false);
  const resetCaptureFrames = useCallback(() => {
    capFramesRef.current = { originAbs: -1, rms: [], acc: 0, accN: 0 };
    lastSpecRef.current = null;
  }, []);

  const log = useCallback((...args: unknown[]) => {
    // console.* in the renderer is forwarded to the main-process stdout by
    // the console-message hook in src/main/index.ts, so these lines are
    // visible in field logs — deliberately terse but greppable.
    console.log('[recorder]', ...args);
  }, []);

  // Forward ref so closures created inside buildPipeline (track handlers)
  // can reach rebuild() without a circular useCallback dependency.
  const rebuildRef = useRef<((reason: string) => Promise<void>) | null>(null);

  /**
   * Pure creation: acquire the mic + wire the graph. Assumes the previous
   * pipeline (if any) has been released. Serialized via warmingRef so
   * concurrent callers await the same build.
   */
  const buildPipeline = useCallback(async (): Promise<void> => {
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
      frameLenRef.current = Math.max(1, Math.round((sr * 30) / 1000));
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
        // Liveness heartbeat FIRST — this stamp is the single source of
        // truth for "the pipeline is actually delivering samples".
        lastTickAtRef.current = Date.now();
        tickCountRef.current++;
        const input = e.inputBuffer.getChannelData(0);
        const ring = ringRef.current;
        const ringLen = ringLenRef.current;
        if (!ring || ringLen === 0) return;
        // Only accumulate RMS while capturing (or when the audit harness
        // wants live levels). The mic stays open the whole session
        // (continuous ring), so this callback fires forever — and the
        // recorder is idle far more than it captures. Gating the
        // multiply-add keeps the steady-state idle path to just the Int16
        // write.
        const capturing = capturingRef.current;
        const wantRms = capturing || auditRef.current;
        let sumSq = 0;
        let wc = writeCountRef.current;
        // Incremental 30 ms frame RMS for the current capture — feeds the
        // speculative end-of-utterance checker without any per-check
        // full-clip rescan. Idle path (not capturing) pays nothing.
        const fa = capturing ? capFramesRef.current : null;
        if (fa && fa.originAbs < 0) fa.originAbs = wc;
        const frameLen = frameLenRef.current;
        for (let i = 0; i < input.length; i++) {
          const s = input[i];
          if (wantRms) sumSq += s * s;
          if (fa) {
            fa.acc += s * s;
            if (++fa.accN >= frameLen) {
              fa.rms.push(Math.sqrt(fa.acc / fa.accN));
              fa.acc = 0; fa.accN = 0;
            }
          }
          // Float[-1,1] → Int16
          let v = s < 0 ? s * 0x8000 : s * 0x7fff;
          if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
          ring[wc % ringLen] = v;
          wc++;
        }
        writeCountRef.current = wc;
        if (wantRms) {
          const rms = Math.sqrt(sumSq / input.length);
          lastRmsRef.current = rms;
          if (capturing) optsRef.current.onLevel?.(Math.min(1, rms * 2.5));
        }
      };

      source.connect(proc);
      proc.connect(sink);
      sink.connect(ctx.destination);

      // Device-level death signals. 'ended' = track gone for good (device
      // unplugged / driver reset) → rebuild now. 'mute' can be a transient
      // (Windows ducking, device grabbed in exclusive mode) — a muted track
      // KEEPS ticking with zeros, so tick-liveness can't see it; rebuild
      // only if it persists.
      for (const t of stream.getTracks()) {
        t.onended = () => {
          log('track ended — device lost');
          if (healEnabledRef.current && !suspendedByAppRef.current) {
            void rebuildRef.current?.('track-ended').catch(() => {});
          }
        };
        t.onmute = () => {
          log('track muted');
          if (!healEnabledRef.current || suspendedByAppRef.current) return;
          if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
          muteTimerRef.current = setTimeout(() => {
            const tr = streamRef.current?.getTracks()[0];
            if (tr && tr.muted) {
              log(`track still muted after ${MUTE_PERSIST_MS}ms — rebuilding`);
              void rebuildRef.current?.('track-muted').catch(() => {});
            }
          }, MUTE_PERSIST_MS);
        };
        t.onunmute = () => {
          if (muteTimerRef.current) { clearTimeout(muteTimerRef.current); muteTimerRef.current = null; }
        };
      }

      try { (window as any).parlys?.prewarm?.(); } catch { /* best-effort */ }
    })();
    try {
      await warmingRef.current;
    } catch (err) {
      streamRef.current = null;
      throw err;
    } finally {
      warmingRef.current = null;
    }
  }, [log]);

  const release = useCallback(() => {
    capturingRef.current = false;
    if (muteTimerRef.current) { clearTimeout(muteTimerRef.current); muteTimerRef.current = null; }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) { t.onended = null; t.onmute = null; t.onunmute = null; }
    }
    if (procRef.current) { try { procRef.current.onaudioprocess = null as any; procRef.current.disconnect(); } catch {} procRef.current = null; }
    if (sinkRef.current) { try { sinkRef.current.disconnect(); } catch {} sinkRef.current = null; }
    if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch {} sourceRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (ctxRef.current) { try { ctxRef.current.close(); } catch {} ctxRef.current = null; }
    ringRef.current = null;
  }, []);

  /** Resolve true as soon as a NEW tick lands (vs `baseline`), else false. */
  const waitForTick = useCallback((baseline: number, timeoutMs: number): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const poll = () => {
        if (tickCountRef.current > baseline) { resolve(true); return; }
        if (Date.now() - t0 >= timeoutMs) { resolve(false); return; }
        setTimeout(poll, 40);
      };
      poll();
    });
  }, []);

  /**
   * THE single destructive path: tear the whole pipeline down and bring it
   * back up. Serialized (multiple triggers — watchdog, track events,
   * devicechange, system resume, start() — can fire together after a
   * wake). If a capture was in flight, it continues on the fresh ring: the
   * stalled portion was never recorded anyway, and re-anchoring
   * captureStart on the new ring's origin keeps the slice math valid (a
   * stale absolute index against a reset writeCount would make stop()
   * compute count<0).
   */
  const rebuild = useCallback(async (reason: string): Promise<void> => {
    if (rebuildingRef.current) return rebuildingRef.current;
    rebuildingRef.current = (async () => {
      const hadPipeline = !!(streamRef.current || ctxRef.current);
      const wasCapturing = capturingRef.current;
      log(hadPipeline ? `rebuild (${reason})` : `warm-up (${reason})`);
      release();
      await buildPipeline();
      if (wasCapturing && mountedRef.current) {
        captureStartRef.current = 0; // fresh ring starts at writeCount 0
        capturingRef.current = true;
        // The pre-rebuild frames/speculation refer to ring coordinates that
        // no longer exist (writeCount reset) — and possibly to audio a
        // healed pipeline must never ship. Start clean on the fresh ring.
        resetCaptureFrames();
      }
      if (hadPipeline) {
        rebuildsRef.current++;
        log(`rebuild done (#${rebuildsRef.current})`);
      }
    })();
    try {
      await rebuildingRef.current;
    } catch (err) {
      lastRebuildFailAtRef.current = Date.now();
      throw err;
    } finally {
      rebuildingRef.current = null;
    }
  }, [buildPipeline, release, log, resetCaptureFrames]);
  rebuildRef.current = rebuild;

  /** Create-if-absent (or replace-if-dead). Non-destructive when healthy. */
  const ensureWarm = useCallback(async (): Promise<void> => {
    if (streamRef.current && streamRef.current.active && procRef.current) return;
    await rebuild('pipeline-absent-or-dead');
  }, [rebuild]);

  /**
   * Guarantee the pipeline EXISTS and is DELIVERING samples before we
   * promise the caller a capture. Fast path (healthy warm pipeline: a tick
   * landed <450 ms ago) costs nothing. Degraded paths: resume a suspended
   * ctx → wait a beat; still nothing → full rebuild → wait for the first
   * confirmed tick. Throws only when even a fresh getUserMedia can't
   * produce audio.
   */
  const ensureLive = useCallback(async (): Promise<void> => {
    await ensureWarm();
    if (!healEnabledRef.current) return;         // legacy A/B behaviour
    if (suspendedByAppRef.current) return;       // interpreter owns the mic
    if (Date.now() - lastTickAtRef.current < TICK_FRESH_MS) return;

    // Not ticking. Cheapest candidate first: a suspended/interrupted
    // context (classic post-sleep state) often just needs resume().
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== 'running') {
      try { await ctx.resume(); } catch { /* rebuild below */ }
    }
    if (await waitForTick(tickCountRef.current, START_CONFIRM_MS)) {
      log('ensureLive: resume/wait sufficed');
      return;
    }
    await rebuild('stale-at-start');
    if (!(await waitForTick(tickCountRef.current, REBUILD_CONFIRM_MS))) {
      throw new Error('Micro indisponible — aucun signal audio après réinitialisation');
    }
  }, [ensureWarm, rebuild, waitForTick, log]);

  // Warm on mount, keep warm the whole session (no idle release — that was
  // the cause of the intermittent "pas du tout" cold starts). Re-verify on
  // focus/visibility if the stream ever died.
  useEffect(() => {
    mountedRef.current = true;
    void ensureLive().catch(() => { /* retried on start() / watchdog */ });
    const onShow = () => { if (document.visibilityState === 'visible') void ensureLive().catch(() => {}); };
    window.addEventListener('focus', onShow);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('focus', onShow);
      document.removeEventListener('visibilitychange', onShow);
      release();
    };
  }, [ensureLive, release]);

  // Watchdog — the always-on safety net. Every 2 s: if the pipeline should
  // be ticking but isn't (idle >3.5 s / capturing >2 s without a tick), the
  // stream itself died (stopped tracks keep ticking ZEROS, so tick
  // freshness alone can't see that), or the wall clock jumped (machine
  // slept through the interval), heal: resume() first (cheap), full
  // rebuild if that doesn't restore ticks. Proactive healing here means
  // the pre-roll is usually warm again BEFORE the user presses the hotkey
  // — start() then costs nothing extra.
  useEffect(() => {
    if (!healEnabledRef.current) return;
    let lastRun = Date.now();
    let healing = false;
    const id = setInterval(() => {
      const now = Date.now();
      const gap = now - lastRun;
      lastRun = now;
      if (healing || suspendedByAppRef.current || rebuildingRef.current || warmingRef.current) return;
      if (!mountedRef.current) return;
      const sinceTick = now - lastTickAtRef.current;
      const stale = capturingRef.current ? sinceTick > CAPTURE_STALE_MS : sinceTick > IDLE_STALE_MS;
      const streamDead = !!streamRef.current && !streamRef.current.active;
      const clockJumped = gap > CLOCK_JUMP_MS;
      if (!stale && !clockJumped && !streamDead) return;
      if (now - lastRebuildFailAtRef.current < REBUILD_FAIL_BACKOFF_MS) return;
      healing = true;
      void (async () => {
        try {
          if (!streamDead) {
            // Cheap candidate first — only meaningful while the stream is alive.
            const ctx = ctxRef.current;
            if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch { /* fall through */ } }
            if (await waitForTick(tickCountRef.current, 400)) {
              log(`watchdog: resume healed the pipeline (${clockJumped ? 'clock-jump' : `stale ${sinceTick}ms`})`);
              return;
            }
          }
          await rebuild(
            streamDead ? 'stream-dead' : clockJumped ? 'wake-from-sleep' : `stale-${sinceTick}ms`,
          );
        } catch (e: any) {
          log('watchdog: heal failed —', e?.message || e);
        } finally {
          healing = false;
        }
      })();
    }, WATCHDOG_EVERY_MS);
    return () => clearInterval(id);
  }, [rebuild, waitForTick, log]);

  // Device topology changed (headset plugged/unplugged, default mic
  // switched). While idle, grab a fresh stream so we follow the NEW
  // default device; mid-capture we leave the current stream alone (the
  // watchdog + next start() heal if it actually died).
  useEffect(() => {
    if (!healEnabledRef.current) return;
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => {
      if (deviceChangeTimerRef.current) clearTimeout(deviceChangeTimerRef.current);
      deviceChangeTimerRef.current = setTimeout(() => {
        deviceChangeTimerRef.current = null;
        if (capturingRef.current || suspendedByAppRef.current || !mountedRef.current) return;
        log('devicechange — re-acquiring default input');
        void rebuild('device-change').catch(() => {});
      }, 700);
    };
    md.addEventListener('devicechange', onChange);
    return () => {
      md.removeEventListener('devicechange', onChange);
      if (deviceChangeTimerRef.current) { clearTimeout(deviceChangeTimerRef.current); deviceChangeTimerRef.current = null; }
    };
  }, [rebuild, log]);

  // Main broadcasts powerMonitor resume/unlock. The pipeline is the prime
  // suspect after a sleep — verify it within a beat and heal proactively,
  // instead of waiting for the user's first (failed) dictation.
  useEffect(() => {
    if (!healEnabledRef.current) return;
    const unsub = (window as any).parlys?.onSystemResumed?.(() => {
      log('system resumed — verifying pipeline');
      setTimeout(() => {
        if (suspendedByAppRef.current || !mountedRef.current) return;
        void (async () => {
          const ctx = ctxRef.current;
          if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch { /* fall through */ } }
          if (await waitForTick(tickCountRef.current, 500)) { log('post-resume: pipeline alive'); return; }
          try { await rebuild('system-resume'); } catch (e: any) { log('post-resume heal failed —', e?.message || e); }
        })();
      }, 700); // give WASAPI a moment to re-enumerate endpoints after wake
    });
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, [rebuild, waitForTick, log]);

  /**
   * Copy [startAbs, endAbs) out of the ring with at most two memcpy-speed
   * subarray copies. Re-clamps the start to the ring's CURRENT oldest valid
   * sample: for a capture longer than RING_SECONDS the ring has wrapped and
   * overwritten the old slots — reading from the stale absolute index would
   * walk the ring at the wrong phase → temporally scrambled audio. Clamping
   * makes an over-length capture cleanly return the most-recent
   * RING_SECONDS in correct chronological order.
   * Returns null when the ring never advanced past startAbs (dead pipeline).
   */
  const sliceRing = useCallback((startAbsRaw: number, endAbs: number): { pcm: Int16Array; startAbs: number } | null => {
    const ring = ringRef.current;
    const ringLen = ringLenRef.current;
    if (!ring || ringLen === 0) return null;
    const startAbs = Math.max(startAbsRaw, endAbs - ringLen);
    const count = endAbs - startAbs;
    if (count <= 0) return null;
    const pcm = new Int16Array(count);
    const r = startAbs % ringLen;
    if (r + count <= ringLen) {
      pcm.set(ring.subarray(r, r + count));
    } else {
      const first = ringLen - r;
      pcm.set(ring.subarray(r));
      pcm.set(ring.subarray(0, count - first), first);
    }
    return { pcm, startAbs };
  }, []);

  /**
   * Gate + trim + downsample + encode one clip — the SINGLE path shared by
   * stop() and the speculative fire so both ship byte-identical audio for
   * the same utterance. blob is null when the gate found no speech.
   */
  const buildClip = useCallback((pcm: Int16Array, sr: number): {
    analysis: SpeechAnalysis;
    blob: Blob | null;
    stats: CaptureStats | null;
  } => {
    // Speech gate: no plausible speech → no API call. This is the primary
    // barrier against Whisper's silence hallucinations ("Merci.", "Thank
    // you.") — silence never leaves the machine any more. The clip always
    // includes the 1 s pre-roll, so the adaptive noise floor has real
    // ambience to calibrate against.
    const analysis = analyzeSpeech(pcm, sr);
    if (!analysis.hasSpeech) return { analysis, blob: null, stats: null };
    // Trim head/tail silence (with natural margins). Trailing silence is
    // Whisper's other hallucination trigger — a real phrase used to come
    // back with ", Merci." appended when the user paused before pressing
    // stop. Also shrinks the upload.
    const speechPcm = trimToSpeech(pcm, analysis);
    const shippedMs = Math.round((speechPcm.length / sr) * 1000);
    // Downsample toward 16 kHz before encoding — smaller upload, zero quality
    // loss for Whisper (it resamples to 16 kHz internally anyway).
    const { data: ds, rate: dsRate } = downsampleToward16k(speechPcm, sr);
    const wav = encodeWavMono16(ds, dsRate);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const stats: CaptureStats = {
      totalMs: analysis.totalMs,
      speechMs: analysis.speechMs,
      shippedMs,
      noiseFloor: analysis.noiseFloor,
      peakRms: analysis.peakRms,
      // Speech geometry for the server-side hallucination cross-check.
      speechMeta: speechMetaFor(analysis, sr),
    };
    return { analysis, blob, stats };
  }, []);

  const start = useCallback(async () => {
    try {
      await ensureLive();
      if (!ringRef.current) throw new Error('Microphone indisponible');
      const prerollSamples = Math.floor(sampleRateRef.current * PREROLL_MS / 1000);
      // Capture from (now − pre-roll), clamped so we never read before the
      // ring's oldest valid sample.
      const oldest = Math.max(0, writeCountRef.current - ringLenRef.current);
      captureStartRef.current = Math.max(oldest, writeCountRef.current - prerollSamples);
      resetCaptureFrames();
      captureIdRef.current =
        (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `cap-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      capturingRef.current = true;
    } catch (err: any) {
      capturingRef.current = false;
      optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [ensureLive, resetCaptureFrames]);

  const stop = useCallback(() => {
    if (!capturingRef.current) return;
    capturingRef.current = false;
    // Snapshot the speculation BEFORE the state resets below.
    const finishedSpec = lastSpecRef.current;
    // Every non-ship exit goes through onDrop so the view ALWAYS leaves its
    // 'recording' state — a silent return here used to freeze the pill red.
    const drop = (reason: string, detail?: string) => {
      log(`drop: ${reason}${detail ? ` (${detail})` : ''}`);
      resetCaptureFrames();
      optsRef.current.onDrop?.(reason);
    };
    if (!ringRef.current || ringLenRef.current === 0) { drop('Micro indisponible'); return; }
    const endAbs = writeCountRef.current;
    const requestedStartAbs = captureStartRef.current;
    const slice = sliceRing(requestedStartAbs, endAbs);
    // No slice = the ring never advanced past our start point — a dead
    // pipeline that start()'s liveness check missed (or heal disabled).
    // Never ship: the slice would be stale/garbage audio → hallucinations.
    if (!slice) {
      drop('Micro muet — aucun audio capturé');
      if (healEnabledRef.current) void rebuild('dead-at-stop').catch(() => {});
      return;
    }
    const sr = sampleRateRef.current;
    const audioMs = Math.round((slice.pcm.length / sr) * 1000);
    // Skip trivially short captures (accidental tap / stop-right-after-start).
    if (audioMs < MIN_CLIP_MS) { drop('Enregistrement trop court'); return; }
    const { analysis, blob, stats } = buildClip(slice.pcm, sr);
    const fmt = (x: number) => x.toFixed(4);
    if (!blob || !stats) {
      drop(
        'Aucune parole détectée',
        `total=${analysis.totalMs}ms speech=${analysis.speechMs}ms run=${analysis.longestRunFrames} ` +
        `floor=${fmt(analysis.noiseFloor)} peak=${fmt(analysis.peakRms)} thr=${fmt(analysis.threshold)}`,
      );
      return;
    }
    // Speculation handshake: valid iff the end of qualified speech hasn't
    // moved since the speculative clip was built (the user did NOT speak
    // again between the fire and the stop). Compared in ABSOLUTE ring
    // samples with a small tolerance for frame-boundary jitter.
    let spec: { id: string } | null = null;
    if (finishedSpec) {
      const finalEndAbs = slice.startAbs + analysis.lastSpeechEndSample;
      const tolSamples = Math.round((SPEC_TOL_MS / 1000) * sr);
      if (Math.abs(finalEndAbs - finishedSpec.endAbs) <= tolSamples) {
        spec = { id: finishedSpec.id };
      } else {
        log(`spec invalid at stop: speech end moved ${finishedSpec.endAbs}→${finalEndAbs}`);
      }
    }
    // Ring-overflow detection: sliceRing clamps the start when the capture
    // outgrew the ring — the beginning is GONE. That loss must never be
    // silent (it used to be: first sentences of very long dictations
    // vanished with zero feedback).
    const truncatedMs = slice.startAbs > requestedStartAbs
      ? Math.round(((slice.startAbs - requestedStartAbs) / sr) * 1000)
      : 0;
    if (truncatedMs > 0) {
      log(`ship TRUNCATED: capture outgrew the ${RING_SECONDS}s ring — first ${truncatedMs}ms LOST`);
    }
    log(
      `ship: total=${analysis.totalMs}ms speech=${analysis.speechMs}ms shipped=${stats.shippedMs}ms ` +
      `floor=${fmt(analysis.noiseFloor)} peak=${fmt(analysis.peakRms)} thr=${fmt(analysis.threshold)}` +
      (spec ? ` spec=${spec.id}` : ''),
    );
    resetCaptureFrames();
    optsRef.current.onStop?.(blob, 'audio/wav', audioMs, { ...stats, spec, truncatedMs });
  }, [rebuild, log, sliceRing, buildClip, resetCaptureFrames]);

  // --- Speculative end-of-utterance checker ------------------------------
  // Every 180 ms while capturing: analyze the incrementally-built frame
  // series (one sort of ≤ a few thousand floats — sub-millisecond). When
  // the user has been silent ≥ SPEC_SILENCE_MS after real speech, build the
  // clip up to end-of-speech through the SAME gate/trim/encode path stop()
  // uses and hand it to the view, which fires the transcription pipeline in
  // the background. One fire per distinct end-of-speech: the fire is
  // deduped on the absolute sample index, so a 10 s silence doesn't refire,
  // and resumed speech naturally re-arms it.
  useEffect(() => {
    const id = setInterval(() => {
      if (!capturingRef.current || specBusyRef.current) return;
      if (specHashDisabledRef.current || optsRef.current.speculative === false) return;
      const cb = optsRef.current.onSpeculativeReady;
      if (!cb) return;
      const fa = capFramesRef.current;
      if (fa.originAbs < 0 || fa.rms.length < SPEC_MIN_FRAMES) return;
      // Long-capture cap: past SPEC_MAX_CLIP_MS every fire would upload the
      // ever-growing whole clip for a shrinking benefit — stop speculating,
      // the classic path at stop() handles it.
      const capturedMs = ((writeCountRef.current - captureStartRef.current) / Math.max(1, sampleRateRef.current)) * 1000;
      if (capturedMs > SPEC_MAX_CLIP_MS) return;
      const res = analyzeFrameSeries(fa.rms);
      if (!res.hasSpeech || res.lastSpeechFrame < 0) return;
      if (res.trailingSilenceMs < SPEC_SILENCE_MS) return;
      const sr = sampleRateRef.current;
      const dedupeSamples = Math.round((SPEC_DEDUPE_MS / 1000) * sr);
      const endAbsGuess = fa.originAbs + (res.lastSpeechFrame + 1) * frameLenRef.current;
      if (lastSpecRef.current && Math.abs(lastSpecRef.current.endAbs - endAbsGuess) <= dedupeSamples) return;
      specBusyRef.current = true;
      try {
        // Slice up to speech-end + 500 ms of the observed silence so the
        // full-path analysis/trim sees the same tail a stop() would.
        const sliceEnd = Math.min(writeCountRef.current, endAbsGuess + Math.round(sr * 0.5));
        const slice = sliceRing(captureStartRef.current, sliceEnd);
        if (!slice) return;
        const { analysis, blob, stats } = buildClip(slice.pcm, sr);
        if (!blob || !stats) return;
        const specEndAbs = slice.startAbs + analysis.lastSpeechEndSample;
        if (lastSpecRef.current && Math.abs(lastSpecRef.current.endAbs - specEndAbs) <= dedupeSamples) return;
        const specId = `${captureIdRef.current}#${++specSeqRef.current}`;
        lastSpecRef.current = { id: specId, endAbs: specEndAbs, firedAt: Date.now() };
        log(
          `spec fire ${specId} trailing=${res.trailingSilenceMs}ms ` +
          `shipped=${stats.shippedMs}ms speech=${stats.speechMs}ms`,
        );
        cb(blob, 'audio/wav', analysis.totalMs, stats, specId);
      } finally {
        specBusyRef.current = false;
      }
    }, SPEC_CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [sliceRing, buildClip, log]);

  const isRecording = useCallback(() => capturingRef.current, []);

  // Suspend/resume the warm pipeline. Used when ANOTHER mic pipeline (the
  // continuous interpreter) is active, so we don't run two AudioContexts +
  // two getUserMedia streams on the same device simultaneously (WASAPI
  // contention + wasted CPU). suspend() pauses the AudioContext (stops the
  // onaudioprocess ring writes) without releasing the device; resume()
  // restarts it. The suspendedByApp flag keeps the watchdog/liveness checks
  // dormant meanwhile — an app-suspended context is NOT a zombie.
  const suspend = useCallback(() => {
    suspendedByAppRef.current = true;
    const ctx = ctxRef.current;
    if (ctx && ctx.state === 'running') { try { void ctx.suspend(); } catch { /* ignore */ } }
  }, []);
  const resume = useCallback(() => {
    suspendedByAppRef.current = false;
    const ctx = ctxRef.current;
    if (ctx && ctx.state === 'suspended') { try { void ctx.resume(); } catch { /* ignore */ } }
    // The device may have died WHILE we were suspended (sleep during an
    // interpreter session) — verify and heal in the background.
    if (healEnabledRef.current) {
      void (async () => {
        if (await waitForTick(tickCountRef.current, 600)) return;
        try { await rebuild('resume-after-suspend'); } catch { /* watchdog retries */ }
      })();
    }
  }, [rebuild, waitForTick]);

  // Test/audit hooks — exposed ONLY when main baked `;audit=1` into the URL
  // hash (env PARLYS_AUDIT=1). getState() is a read-only snapshot; kill()
  // reproduces the two real-world death modes against the LIVE pipeline:
  //   'suspend'    → ctx.suspend() without the app flag = post-sleep zombie
  //                  (stream stays "active", ticks stop);
  //   'stoptracks' → track.stop() = device disappeared (unplug/driver reset).
  useEffect(() => {
    if (!auditRef.current) return;
    (window as any).__parlysAudioAudit = {
      getState: () => {
        // Live capture VAD view for the harness: trailing silence + speech
        // time measured exactly like the speculative checker does.
        let trailingSilenceMs = -1;
        let captureSpeechMs = -1;
        const fa = capFramesRef.current;
        if (capturingRef.current && fa.originAbs >= 0 && fa.rms.length >= 4) {
          const res = analyzeFrameSeries(fa.rms);
          trailingSilenceMs = res.hasSpeech ? res.trailingSilenceMs : -1;
          captureSpeechMs = res.speechMs;
        }
        return {
          ctxState: ctxRef.current?.state ?? 'none',
          streamActive: !!streamRef.current?.active,
          capturing: capturingRef.current,
          writeCount: writeCountRef.current,
          tickCount: tickCountRef.current,
          lastTickAgoMs: lastTickAtRef.current ? Date.now() - lastTickAtRef.current : -1,
          sampleRate: sampleRateRef.current,
          rebuilds: rebuildsRef.current,
          healEnabled: healEnabledRef.current,
          suspendedByApp: suspendedByAppRef.current,
          lastRms: lastRmsRef.current,
          specEnabled: !specHashDisabledRef.current && optsRef.current.speculative !== false,
          specSeq: specSeqRef.current,
          lastSpecId: lastSpecRef.current?.id ?? null,
          trailingSilenceMs,
          captureSpeechMs,
        };
      },
      kill: (mode: 'suspend' | 'stoptracks') => {
        if (mode === 'suspend') {
          try { void ctxRef.current?.suspend(); } catch { /* ignore */ }
        } else {
          try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        }
        return mode;
      },
    };
    return () => { try { delete (window as any).__parlysAudioAudit; } catch { /* ignore */ } };
  }, []);

  return { start, stop, isRecording, suspend, resume };
}
