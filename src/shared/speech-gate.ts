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
}

const DEFAULTS: Required<SpeechGateOptions> = {
  frameMs: 30,
  minSpeechMs: 180,
  minRunFrames: 4,      // ≥120 ms sustained — any real word qualifies
  absMinRms: 0.009,     // ≈ -41 dBFS; normal speech on a 100%-gain mic is 0.05+
  noiseMult: 2.5,
  adaptiveCap: 0.045,
  leadMs: 250,
  tailMs: 320,
};

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
  const frameCount = Math.floor(pcm.length / frameLen);

  const empty: SpeechAnalysis = {
    hasSpeech: false, speechMs: 0, longestRunFrames: 0, totalMs,
    noiseFloor: 0, peakRms: 0, threshold: o.absMinRms,
    trimStart: 0, trimEnd: pcm.length,
  };
  if (frameCount === 0) return empty;

  // Frame RMS on the normalized [-1, 1] scale (Int16 / 32768).
  const rms = new Float64Array(frameCount);
  let peakRms = 0;
  for (let f = 0; f < frameCount; f++) {
    const base = f * frameLen;
    let sumSq = 0;
    for (let i = 0; i < frameLen; i++) {
      const v = pcm[base + i] / 32768;
      sumSq += v * v;
    }
    const r = Math.sqrt(sumSq / frameLen);
    rms[f] = r;
    if (r > peakRms) peakRms = r;
  }

  // Noise floor = 20th percentile of frame RMS. The dictation clip always
  // carries the 1 s pre-roll (mostly room tone), so a low percentile is a
  // reliable ambience estimate; for all-speech clips the adaptiveCap below
  // keeps the derived threshold sane anyway.
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const noiseFloor = sorted[Math.max(0, Math.floor(frameCount * 0.2) - 1)] ?? 0;
  const threshold = Math.min(
    Math.max(o.absMinRms, noiseFloor * o.noiseMult),
    Math.max(o.absMinRms, o.adaptiveCap),
  );

  let speechFrames = 0;
  let firstSpeech = -1;
  let lastSpeech = -1;
  let run = 0;
  let longestRunFrames = 0;
  for (let f = 0; f < frameCount; f++) {
    if (rms[f] > threshold) {
      speechFrames++;
      run++;
      if (run > longestRunFrames) longestRunFrames = run;
      if (firstSpeech === -1) firstSpeech = f;
      lastSpeech = f;
    } else {
      run = 0;
    }
  }

  const speechMs = speechFrames * o.frameMs;
  const hasSpeech =
    speechMs >= o.minSpeechMs &&
    longestRunFrames >= o.minRunFrames &&
    peakRms > threshold;

  if (!hasSpeech || firstSpeech === -1) {
    return { ...empty, speechMs, longestRunFrames, noiseFloor, peakRms, threshold };
  }

  const leadFrames = Math.ceil(o.leadMs / o.frameMs);
  const tailFrames = Math.ceil(o.tailMs / o.frameMs);
  const startFrame = Math.max(0, firstSpeech - leadFrames);
  const endFrame = Math.min(frameCount, lastSpeech + 1 + tailFrames);

  return {
    hasSpeech: true,
    speechMs,
    longestRunFrames,
    totalMs,
    noiseFloor,
    peakRms,
    threshold,
    trimStart: startFrame * frameLen,
    // If the tail margin reaches the last full frame, keep the ragged
    // remainder samples too (never cut real audio for a rounding artefact).
    trimEnd: endFrame >= frameCount ? pcm.length : endFrame * frameLen,
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
