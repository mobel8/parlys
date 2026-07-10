// Unit tests for src/shared/speech-gate.ts — run against the COMPILED
// dist/shared/speech-gate.js (same bytes the app executes, no ts-node
// approximation). Synthesizes PCM deterministically: silence, low noise,
// speech-shaped modulated tones, isolated clicks.
//
// Usage: node scripts/test-speech-gate.js   (exit 0 = all pass)

'use strict';
const path = require('path');
const { analyzeSpeech, trimToSpeech } = require(path.join(__dirname, '..', 'dist', 'shared', 'speech-gate.js'));

const SR = 48000;
let failures = 0;
let idx = 0;

function check(name, cond, detail) {
  idx++;
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(idx).padStart(2)} ${name}${detail ? `  [${detail}]` : ''}`);
}

/** Deterministic PRNG so failures reproduce byte-for-byte. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Append `ms` of gaussian-ish noise at target RMS into arr. */
function pushNoise(arr, ms, rms, rnd) {
  const n = Math.round((SR * ms) / 1000);
  for (let i = 0; i < n; i++) {
    // sum of 4 uniforms ≈ gaussian, std 1/√12*2=0.577 → scale to rms
    const g = (rnd() + rnd() + rnd() + rnd() - 2) / 0.577 / 2;
    arr.push(Math.max(-32768, Math.min(32767, Math.round(g * rms * 32768))));
  }
}

/** Append `ms` of speech-shaped audio: 140 Hz carrier + harmonics, 4 Hz syllabic envelope. */
function pushSpeech(arr, ms, peak) {
  const n = Math.round((SR * ms) / 1000);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t); // syllable rhythm
    const s = Math.sin(2 * Math.PI * 140 * t) * 0.6
            + Math.sin(2 * Math.PI * 280 * t) * 0.3
            + Math.sin(2 * Math.PI * 560 * t) * 0.1;
    arr.push(Math.max(-32768, Math.min(32767, Math.round(s * env * peak * 32768))));
  }
}

function toPcm(arr) { return Int16Array.from(arr); }
function rmsOf(pcm) {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; s += v * v; }
  return Math.sqrt(s / pcm.length);
}

// ---------------------------------------------------------------- fixtures
const rnd = mulberry32(0xC0FFEE);

// 1) Pure near-silence (room tone ~0.001 RMS), 1.6 s — the hotkey-press-
//    with-no-speech case that used to become a pasted "Merci."
{
  const a = [];
  pushNoise(a, 1600, 0.001, rnd);
  const r = analyzeSpeech(toPcm(a), SR);
  check('silence 1.6s → NO speech', r.hasSpeech === false,
    `speechMs=${r.speechMs} thr=${r.threshold.toFixed(4)} peak=${r.peakRms.toFixed(4)}`);
}

// 2) Low ambient noise (fan, 0.004 RMS), 2 s → still no speech.
{
  const a = [];
  pushNoise(a, 2000, 0.004, rnd);
  const r = analyzeSpeech(toPcm(a), SR);
  check('fan noise 2s → NO speech', r.hasSpeech === false,
    `speechMs=${r.speechMs} thr=${r.threshold.toFixed(4)}`);
}

// 3) Classic dictation: 1 s pre-roll room tone + 0.8 s speech + 1 s tail.
{
  const a = [];
  pushNoise(a, 1000, 0.0015, rnd);
  pushSpeech(a, 800, 0.25);
  pushNoise(a, 1000, 0.0015, rnd);
  const pcm = toPcm(a);
  const r = analyzeSpeech(pcm, SR);
  check('preroll+speech0.8s+tail → speech', r.hasSpeech === true,
    `speechMs=${r.speechMs} run=${r.longestRunFrames}`);
  check('speechMs in plausible range', r.speechMs >= 400 && r.speechMs <= 1000, `speechMs=${r.speechMs}`);
  const trimmed = trimToSpeech(pcm, r);
  const trimmedMs = Math.round((trimmed.length / SR) * 1000);
  check('trim removes most head/tail silence', trimmedMs >= 900 && trimmedMs <= 1900,
    `trimmedMs=${trimmedMs} (total 2800)`);
  check('trim keeps a lead margin', r.trimStart > 0 && r.trimStart <= Math.round(SR * 0.85),
    `trimStartMs=${Math.round((r.trimStart / SR) * 1000)}`);
}

// 4) Single keyboard click (60 ms burst) inside 1.5 s of room tone → gated
//    (sustained-run requirement).
{
  const a = [];
  pushNoise(a, 700, 0.0015, rnd);
  pushNoise(a, 60, 0.30, rnd);   // sharp transient
  pushNoise(a, 740, 0.0015, rnd);
  const r = analyzeSpeech(toPcm(a), SR);
  check('isolated click → NO speech', r.hasSpeech === false,
    `speechMs=${r.speechMs} run=${r.longestRunFrames}`);
}

// 5) Click train: 8 isolated 30 ms clicks over 2.4 s (typing while not
//    speaking). Cumulative energy passes minSpeechMs but runs stay short.
{
  const a = [];
  for (let k = 0; k < 8; k++) {
    pushNoise(a, 30, 0.25, rnd);
    pushNoise(a, 270, 0.0015, rnd);
  }
  const r = analyzeSpeech(toPcm(a), SR);
  check('click train → NO speech', r.hasSpeech === false,
    `speechMs=${r.speechMs} run=${r.longestRunFrames}`);
}

// 6) QUIET speech (0.02 peak) over a very low floor → adaptive threshold
//    keeps it (absolute floor 0.009 < speech level).
{
  const a = [];
  pushNoise(a, 900, 0.001, rnd);
  pushSpeech(a, 900, 0.045); // quiet but real — frame RMS ≈ 0.02
  pushNoise(a, 500, 0.001, rnd);
  const pcm = toPcm(a);
  const r = analyzeSpeech(pcm, SR);
  check('quiet speech → speech', r.hasSpeech === true,
    `peak=${r.peakRms.toFixed(4)} thr=${r.threshold.toFixed(4)} speechMs=${r.speechMs}`);
}

// 7) All-speech clip (user talked wall-to-wall — no silence for the noise
//    percentile): adaptiveCap must keep the threshold below speech level.
{
  const a = [];
  pushSpeech(a, 2000, 0.28);
  const pcm = toPcm(a);
  const r = analyzeSpeech(pcm, SR);
  check('wall-to-wall speech → speech', r.hasSpeech === true,
    `floor=${r.noiseFloor.toFixed(4)} thr=${r.threshold.toFixed(4)} speechMs=${r.speechMs}`);
  const trimmed = trimToSpeech(pcm, r);
  check('wall-to-wall trim keeps ~everything', trimmed.length >= pcm.length * 0.9,
    `kept=${Math.round((trimmed.length / pcm.length) * 100)}%`);
}

// 8) Degenerate inputs never throw.
{
  const r0 = analyzeSpeech(new Int16Array(0), SR);
  check('empty pcm → no speech, no throw', r0.hasSpeech === false);
  const r1 = analyzeSpeech(new Int16Array(100), SR); // sub-frame
  check('sub-frame pcm → no speech, no throw', r1.hasSpeech === false);
}

// 9) Sanity: our synthetic speech really is speech-level audio (guards the
//    fixtures themselves against silent regressions).
{
  const a = [];
  pushSpeech(a, 500, 0.25);
  const level = rmsOf(toPcm(a));
  check('fixture sanity: speech RMS ≈ 0.1', level > 0.05 && level < 0.25, `rms=${level.toFixed(3)}`);
}

console.log(failures === 0 ? '\nALL SPEECH-GATE TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
