/**
 * speech-gate — pure-DSP speech presence detection + head/tail silence trim
 * for a mono Int16 PCM clip.
 *
 * WHY THIS EXISTS
 * ---------------
 * Whisper (all sizes, turbo worst) HALLUCINATES on silence: a clip with no
 * speech comes back as "Merci.", "Thank you.", "Sous-titres réalisés par…"
 * etc., because millions of its training transcripts end that way. The
 * dictation recorder always ships at least the 1 s pre-roll, so a hotkey
 * press with no speech used to ship ≥1 s of pure room tone straight into
 * that failure mode. This module is the client-side barrier:
 *
 *   1. `analyzeSpeech` decides whether the clip contains ANY plausible
 *      speech (frame-level RMS vs an adaptive noise floor). If not, the
 *      recorder drops the clip locally — no API call, no hallucination.
 *   2. `trimToSpeech` cuts the silent head/tail (keeping natural margins),
 *      which removes the trailing-silence hallucination trigger from real
 *      dictations AND shrinks the upload.
 *   3. `analyzeFrameSeries` is the frame-level core, shared with the
 *      recorder's INCREMENTAL path (speculative transcription needs a
 *      cheap "how long has the user been silent since the last word?"
 *      check every ~200 ms while capturing — recomputing full-clip RMS
 *      each time would be O(n²) over a dictation).
 *   4. `speechMetaFor` exports the speech intervals (relative to the
 *      trimmed clip) so the SERVER-side hallucination filter can drop
 *      Whisper segments/words that claim to start where the client knows
 *      the user was silent — the "il rajoute des trucs en fin de phrase"
 *      killer.
 *
 * Design constraints:
 *   - Pure functions, zero DOM/Node dependencies → unit-testable in plain
 *     node against dist/shared/speech-gate.js, usable from the renderer.
 *   - Conservative: false-negatives (real speech dropped) are worse than
 *     false-positives (silence shipped — the server-side verbose_json
 *     filter is the second net). Thresholds have absolute floors AND an
 *     adaptive cap so both silent rooms and hot clips behave.
 *   - Cheap: one pass for frame RMS + one small sort (≈100 frames for 3 s).
 */

export interface SpeechGateOptions {
  /** Analysis frame length. 30 ms ≈ syllable-scale energy resolution. */
  frameMs?: number;
  /** Cumulative speech-frame time required to call the clip "speech". */
  minSpeechMs?: number;
  /**
   * Minimum CONSECUTIVE run of speech frames required (voicing is
   * sustained; keyboard clicks / door slams are 1-2 isolated frames).
   */
  minRunFrames?: number;
  /**
   * Minimum consecutive run for a frame to count toward the speech
   * BOUNDARIES (first/last speech, trim, intervals). Lower than
   * minRunFrames: a word-final consonant may only hold 2 frames, but an
   * ISOLATED single spike (mic bump, key click, breath burst right after
   * the phrase) must NOT extend the speech end — trailing "speech" that is
   * really a click drags the tail margin over noise and re-opens the
   * trailing-hallucination window server-side.
   */
  boundaryRunFrames?: number;
  /** Absolute RMS floor a frame must beat regardless of the noise floor. */
  absMinRms?: number;
  /** Speech threshold = clamp(noiseFloor * this, absMinRms, adaptiveCap). */
  noiseMult?: number;
  /**
   * Upper bound on the adaptive threshold. Protects clips that are speech
   * end-to-end (user talked before the press and until after the release):
   * there the "noise floor" percentile lands on speech energy and an
   * uncapped multiplier would gate the whole clip.
   */
  adaptiveCap?: number;
  /** Silence kept BEFORE the first speech frame when trimming. */
  leadMs?: number;
  /** Silence kept AFTER the last speech frame when trimming. */
  tailMs?: number;
  /**
   * Two qualified speech intervals closer than this are merged when
   * reporting `speechIntervalsMs` (intra-word energy dips and short
   * inter-word gaps are not "silence" the server should act on).
   */
  mergeGapMs?: number;
}

export interface SpeechAnalysis {
  /** Verdict: does the clip plausibly contain speech? */
  hasSpeech: boolean;
  /** Cumulative duration of speech-classified frames. */
  speechMs: number;
  /** Longest consecutive speech run, in frames. */
  longestRunFrames: number;
  totalMs: number;
  /** Adaptive noise floor (RMS, 0..1 scale) — low percentile of frame RMS. */
  noiseFloor: number;
  peakRms: number;
  /** The threshold a frame had to beat to count as speech. */
  threshold: number;
  /** Sample index where the trimmed clip starts (0 if no speech). */
  trimStart: number;
  /** Sample index (exclusive) where the trimmed clip ends. */
  trimEnd: number;
  /**
   * Sample index where BOUNDARY-QUALIFIED speech starts (-1 if none).
   * Unlike trimStart this carries no lead margin.
   */
  firstSpeechSample: number;
  /**
   * Sample index (exclusive) where boundary-qualified speech ends (-1 if
   * none). Unlike trimEnd this carries no tail margin — it is the
   * client-side truth for "the user stopped talking HERE", which the
   * server-side hallucination filter uses to kill trailing inventions and
   * the speculative scheduler uses to detect end-of-utterance.
   */
  lastSpeechEndSample: number;
  /**
   * Boundary-qualified speech intervals in ms from CLIP START (pre-trim),
   * gaps below mergeGapMs merged. Empty when hasSpeech is false.
   */
  speechIntervalsMs: Array<[number, number]>;
}

/** Frame-level result shared by the full-clip and incremental paths. */
export interface FrameSeriesAnalysis {
  frameMs: number;
  frameCount: number;
  noiseFloor: number;
  peakRms: number;
  threshold: number;
  speechFrames: number;
  speechMs: number;
  longestRunFrames: number;
  /** First/last boundary-qualified speech frame (inclusive), -1 if none. */
  firstSpeechFrame: number;
  lastSpeechFrame: number;
  /** ms of silence between the last qualified speech frame and series end. */
  trailingSilenceMs: number;
  /** Qualified speech intervals as frame indices [start, endExclusive). */
  intervalsFrames: Array<[number, number]>;
  /** Same verdict rule as analyzeSpeech (minSpeechMs + minRunFrames + peak). */
  hasSpeech: boolean;
}

const DEFAULTS: Required<SpeechGateOptions> = {
  frameMs: 30,
  minSpeechMs: 180,
  minRunFrames: 4,      // ≥120 ms sustained — any real word qualifies
  boundaryRunFrames: 2, // ≥60 ms to move a boundary — kills isolated clicks
  absMinRms: 0.009,     // ≈ -41 dBFS; normal speech on a 100%-gain mic is 0.05+
  noiseMult: 2.5,
  adaptiveCap: 0.045,
  leadMs: 250,
  tailMs: 320,
  mergeGapMs: 240,
};

/**
 * Frame-level core: classify a series of frame RMS values against the
 * adaptive threshold and locate qualified speech runs. Pure and cheap
 * (one pass + one sort of ≤ a few thousand floats), so the recorder can
 * call it every ~200 ms on its incrementally-built frame array.
 */
export function analyzeFrameSeries(
  frameRms: ArrayLike<number>,
  opts?: SpeechGateOptions,
): FrameSeriesAnalysis {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const frameCount = frameRms.length;
  const empty: FrameSeriesAnalysis = {
    frameMs: o.frameMs, frameCount, noiseFloor: 0, peakRms: 0,
    threshold: o.absMinRms, speechFrames: 0, speechMs: 0, longestRunFrames: 0,
    firstSpeechFrame: -1, lastSpeechFrame: -1,
    trailingSilenceMs: frameCount * o.frameMs,
    intervalsFrames: [], hasSpeech: false,
  };
  if (frameCount === 0) return empty;

  let peakRms = 0;
  for (let f = 0; f < frameCount; f++) if (frameRms[f] > peakRms) peakRms = frameRms[f];

  // Noise floor = 20th percentile of frame RMS. The dictation clip always
  // carries the 1 s pre-roll (mostly room tone), so a low percentile is a
  // reliable ambience estimate; for all-speech clips the adaptiveCap below
  // keeps the derived threshold sane anyway.
  const sorted = Array.prototype.slice.call(frameRms).sort((a: number, b: number) => a - b);
  const noiseFloor = sorted[Math.max(0, Math.floor(frameCount * 0.2) - 1)] ?? 0;
  const threshold = Math.min(
    Math.max(o.absMinRms, noiseFloor * o.noiseMult),
    Math.max(o.absMinRms, o.adaptiveCap),
  );

  // Pass 1: raw classification + run bookkeeping.
  let speechFrames = 0;
  let longestRunFrames = 0;
  let run = 0;
  // Qualified intervals: runs of ≥ boundaryRunFrames raw speech frames.
  const intervals: Array<[number, number]> = [];
  let runStart = -1;
  const closeRun = (endExclusive: number) => {
    if (runStart >= 0 && endExclusive - runStart >= o.boundaryRunFrames) {
      intervals.push([runStart, endExclusive]);
    }
    runStart = -1;
  };
  for (let f = 0; f < frameCount; f++) {
    if (frameRms[f] > threshold) {
      speechFrames++;
      run++;
      if (run > longestRunFrames) longestRunFrames = run;
      if (runStart === -1) runStart = f;
    } else {
      closeRun(f);
      run = 0;
    }
  }
  closeRun(frameCount);

  // Merge qualified intervals separated by < mergeGapMs.
  const mergeGapFrames = Math.ceil(o.mergeGapMs / o.frameMs);
  const merged: Array<[number, number]> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv[0] - last[1] < mergeGapFrames) last[1] = iv[1];
    else merged.push([iv[0], iv[1]]);
  }

  const firstSpeechFrame = merged.length ? merged[0][0] : -1;
  const lastSpeechFrame = merged.length ? merged[merged.length - 1][1] - 1 : -1;
  const speechMs = speechFrames * o.frameMs;
  const hasSpeech =
    speechMs >= o.minSpeechMs &&
    longestRunFrames >= o.minRunFrames &&
    peakRms > threshold &&
    merged.length > 0;

  return {
    frameMs: o.frameMs, frameCount, noiseFloor, peakRms, threshold,
    speechFrames, speechMs, longestRunFrames,
    firstSpeechFrame: hasSpeech ? firstSpeechFrame : -1,
    lastSpeechFrame: hasSpeech ? lastSpeechFrame : -1,
    trailingSilenceMs: hasSpeech
      ? (frameCount - 1 - lastSpeechFrame) * o.frameMs
      : frameCount * o.frameMs,
    intervalsFrames: hasSpeech ? merged : [],
    hasSpeech,
  };
}

/**
 * Compute per-frame RMS (normalized [-1,1] scale) for an Int16 PCM clip.
 * Exported so callers that already hold PCM can reuse the exact framing.
 */
export function frameRmsOf(
  pcm: Int16Array,
  sampleRate: number,
  frameMs: number = DEFAULTS.frameMs,
): Float64Array {
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const frameCount = Math.floor(pcm.length / frameLen);
  const rms = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const base = f * frameLen;
    let sumSq = 0;
    for (let i = 0; i < frameLen; i++) {
      const v = pcm[base + i] / 32768;
      sumSq += v * v;
    }
    rms[f] = Math.sqrt(sumSq / frameLen);
  }
  return rms;
}

/**
 * Classify each 30 ms frame as speech/non-speech against an adaptive
 * threshold and locate the speech span. One pass + one small sort.
 */
export function analyzeSpeech(
  pcm: Int16Array,
  sampleRate: number,
  opts?: SpeechGateOptions,
): SpeechAnalysis {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const totalMs = Math.round((pcm.length / sampleRate) * 1000);
  const frameLen = Math.max(1, Math.round((sampleRate * o.frameMs) / 1000));
  const rms = frameRmsOf(pcm, sampleRate, o.frameMs);
  const fs = analyzeFrameSeries(rms, opts);

  const empty: SpeechAnalysis = {
    hasSpeech: false, speechMs: fs.speechMs, longestRunFrames: fs.longestRunFrames,
    totalMs, noiseFloor: fs.noiseFloor, peakRms: fs.peakRms, threshold: fs.threshold,
    trimStart: 0, trimEnd: pcm.length,
    firstSpeechSample: -1, lastSpeechEndSample: -1, speechIntervalsMs: [],
  };
  if (!fs.hasSpeech || fs.firstSpeechFrame === -1) return empty;

  const leadFrames = Math.ceil(o.leadMs / o.frameMs);
  const tailFrames = Math.ceil(o.tailMs / o.frameMs);
  const startFrame = Math.max(0, fs.firstSpeechFrame - leadFrames);
  const endFrame = Math.min(fs.frameCount, fs.lastSpeechFrame + 1 + tailFrames);

  return {
    hasSpeech: true,
    speechMs: fs.speechMs,
    longestRunFrames: fs.longestRunFrames,
    totalMs,
    noiseFloor: fs.noiseFloor,
    peakRms: fs.peakRms,
    threshold: fs.threshold,
    trimStart: startFrame * frameLen,
    // If the tail margin reaches the last full frame, keep the ragged
    // remainder samples too (never cut real audio for a rounding artefact).
    trimEnd: endFrame >= fs.frameCount ? pcm.length : endFrame * frameLen,
    firstSpeechSample: fs.firstSpeechFrame * frameLen,
    lastSpeechEndSample: (fs.lastSpeechFrame + 1) * frameLen,
    speechIntervalsMs: fs.intervalsFrames.map(([a, b]) => [a * o.frameMs, b * o.frameMs]),
  };
}

/**
 * Return the speech span of `pcm` per a prior `analyzeSpeech` result.
 * Zero-copy subarray view — callers that need ownership must copy.
 */
export function trimToSpeech(pcm: Int16Array, a: SpeechAnalysis): Int16Array {
  if (!a.hasSpeech) return pcm;
  if (a.trimStart <= 0 && a.trimEnd >= pcm.length) return pcm;
  return pcm.subarray(a.trimStart, a.trimEnd);
}

/**
 * Client-side speech geometry shipped with the transcription request so the
 * SERVER-side hallucination filter can cross-check Whisper's segment/word
 * timestamps against where the client actually measured speech.
 *
 * All times are ms RELATIVE TO THE SHIPPED (trimmed) CLIP — the same
 * timeline Whisper's verbose_json timestamps use.
 */
export interface SpeechMeta {
  /** Merged speech intervals [startMs, endMs) within the shipped clip. */
  intervalsMs: Array<[number, number]>;
  /** End of the LAST detected speech within the shipped clip. */
  endMs: number;
  /** Start of the FIRST detected speech within the shipped clip. */
  startMs: number;
}

/** Build the SpeechMeta for the clip produced by `trimToSpeech(pcm, a)`. */
export function speechMetaFor(a: SpeechAnalysis, sampleRate: number): SpeechMeta | null {
  if (!a.hasSpeech || a.lastSpeechEndSample < 0) return null;
  const toMs = (samples: number) => Math.max(0, Math.round((samples / sampleRate) * 1000));
  const trimStartMs = toMs(a.trimStart);
  const shippedMs = toMs(a.trimEnd - a.trimStart);
  const clamp = (ms: number) => Math.max(0, Math.min(shippedMs, ms));
  const intervals = a.speechIntervalsMs
    .map(([s, e]) => [clamp(s - trimStartMs), clamp(e - trimStartMs)] as [number, number])
    .filter(([s, e]) => e > s);
  return {
    intervalsMs: intervals,
    endMs: clamp(toMs(a.lastSpeechEndSample) - trimStartMs),
    startMs: clamp(toMs(a.firstSpeechSample) - trimStartMs),
  };
}
